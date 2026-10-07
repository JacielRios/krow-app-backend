/** Run after docker compose -f infra/runtime/compose.yaml up -d --wait.
 * Real Kafka/Redis test; does not substitute for authenticated API/load testing.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Kafka, logLevel } from 'kafkajs';
import { createClient } from 'redis';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { RuntimeStreams } from '../apps/api/dist/modules/ride-runtime/infrastructure/runtime-streams.js';

const prefix = `krow-local-${randomUUID()}`;
const kafka = new Kafka({ clientId: prefix, brokers: ['127.0.0.1:59092'], connectionTimeout: 3000, requestTimeout: 5000, retry: { retries: 1 }, logLevel: logLevel.NOTHING });
const admin = kafka.admin(), producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
const redis = createClient({ url: 'redis://127.0.0.1:56379', socket: { connectTimeout: 3000, reconnectStrategy: false } });
redis.on('error', () => {});
const topic = `${prefix}.locations`, keyPrefix = `${prefix}:position:`;
let consumer, created = false;
const streams = new RuntimeStreams(new ConfigService({ RUNTIME_REDIS_URL: 'redis://127.0.0.1:56379' }));
let subscriber, notification;
let projected = 0, requiredMessages = 10000;
const groups = [];
const report = { startedAt: new Date().toISOString(), scope: 'Real local Kafka/Redis primitives, not application HTTP or 50,000 sockets', status: 'failed' };
const timeout = setTimeout(() => { console.error('Broker validation timed out'); process.exit(1); }, 180000);
const waitFor = async predicate => {
  const deadline = Date.now()+20000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Projection did not catch up within 20 seconds');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const projection = async fromBeginning => {
  projected = 0;
  const groupId = `${prefix}-${groups.length}`; groups.push(groupId);
  consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  await consumer.connect(); await consumer.subscribe({ topic, fromBeginning });
  await consumer.run({ partitionsConsumedConcurrently: 8, eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value.toString());
    await redis.eval("local old=redis.call('GET',KEYS[1]); if old and tonumber(old)>=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); return 1", { keys: [`${keyPrefix}${event.ride}`], arguments: [String(event.sequence)] });
    projected++;
  } });
};
try {
  await redis.connect(); await admin.connect();
  assert.equal(await (await streams.redis()).ping(), 'PONG');
  subscriber = await streams.createSubscriber();
  await subscriber.connect();
  await subscriber.subscribe(`${prefix}:probe`, value => { notification = value; });
  await admin.createTopics({ topics: [{ topic, numPartitions: 16, replicationFactor: 1 }], waitForLeaders: true }); created = true;
  await producer.connect();
  const batches = [], latencies = [];
  for (let sequence = 1; sequence <= 100; sequence++) batches.push(Array.from({ length: 100 }, (_,ride) => ({ key: String(ride), value: JSON.stringify({ ride, sequence }) })));
  const start = performance.now();
  for (const messages of batches) {
    const before = performance.now();
    await producer.send({ topic, acks: -1, messages }); latencies.push(performance.now()-before);
  }
  report.publish = { samples: 10000, elapsedMs: Math.round(performance.now()-start), p95BatchAckMs: latencies.sort((a,b)=>a-b)[94] };
  if (process.argv.includes('--restart-brokers')) {
    const run = promisify(execFile), docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
    const compose = ['compose', '-f', fileURLToPath(new URL('../infra/runtime/compose.yaml', import.meta.url))];
    const { stdout } = await run(docker,[...compose,'ps','-q','redis','kafka']);
    const ids = stdout.trim().split(/\s+/);
    assert.equal(ids.length,2,'Both isolated test containers must exist');
    const containers = JSON.parse((await run(docker,['inspect',...ids])).stdout);
    assert(containers.every(container => container.Config.Labels['com.docker.compose.project'] === 'krow-runtime-test'));
    await producer.disconnect(); await admin.disconnect(); await redis.quit();
    const restartStart = performance.now();
    await run(docker,[...compose,'restart','redis','kafka']);
    await run(docker,[...compose,'up','-d','--no-recreate','--wait','--wait-timeout','90']);
    await producer.connect(); await admin.connect(); await redis.connect();
    await waitFor(() => subscriber.isReady);
    assert.equal(await (await streams.redis()).ping(), 'PONG');
    await redis.publish(`${prefix}:probe`, 'recovered');
    await waitFor(() => notification === 'recovered');
    report.applicationRedisRecovery = 'Actual RuntimeStreams request connection and subscriber recovered after Redis restart';
    report.brokerRestart = { elapsedMs: Math.round(performance.now()-restartStart), check: 'Restarted only isolated Kafka/Redis containers after 10,000 durable acknowledgements; named volumes retained' };
  }
  await projection(true);
  const complete = async () => projected >= requiredMessages && (await redis.mGet(Array.from({ length: 100 }, (_,i) => `${keyPrefix}${i}`))).every(value => value === '100');
  await waitFor(complete);
  await producer.send({ topic, acks: -1, messages: [{ key: '0', value: JSON.stringify({ ride: 0, sequence: 1 }) }, { key: '0', value: JSON.stringify({ ride: 0, sequence: 100 }) }] });
  await consumer.stop(); await consumer.disconnect(); consumer = undefined;
  requiredMessages = 10002;
  // Delete only this run's synthetic projection. No FLUSHDB or shared topic deletion.
  await redis.del(Array.from({ length: 100 }, (_,i) => `${keyPrefix}${i}`));
  const recoveryStart = performance.now();
  await projection(true); await waitFor(complete);
  assert.equal(await redis.get(`${keyPrefix}0`),'100');
  report.recovery = { elapsedMs: Math.round(performance.now()-recoveryStart), check: 'Consumer restart and lost Redis projection rebuilt from durable Kafka history; duplicate/older sequences did not regress latest state' };
  report.status = 'passed';
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (subscriber?.isOpen) subscriber.destroy();
  await streams.onModuleDestroy();
  if (consumer) { await consumer.stop().catch(()=>{}); await consumer.disconnect().catch(()=>{}); }
  await producer.disconnect().catch(()=>{});
  if (created) {
    await admin.deleteTopics({ topics: [topic] }).catch(()=>{});
    for (const group of groups) await admin.deleteGroups([group]).catch(()=>{});
  }
  await admin.disconnect().catch(()=>{});
  if (redis.isReady) await redis.del(Array.from({ length: 100 }, (_,i) => `${keyPrefix}${i}`));
  if (redis.isOpen) redis.destroy();
  clearTimeout(timeout);
  report.finishedAt = new Date().toISOString();
  await mkdir(new URL('../artifacts/runtime-local/',import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/runtime-local/brokers-report.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
