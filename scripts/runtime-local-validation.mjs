/** Real PostgreSQL validation. Refuses non-loopback hosts. Creates and removes ONLY its own databases. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { RuntimeDatabase } from '../apps/api/dist/modules/ride-runtime/infrastructure/runtime-database.js';
import { RuntimeService } from '../apps/api/dist/modules/ride-runtime/application/runtime.service.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = new URL(process.env.TEST_RUNTIME_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55439/postgres');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only local databases are allowed');
const operations = Number(process.env.KROW_TEST_OPERATIONS ?? 1000);
const concurrency = Number(process.env.KROW_TEST_CONCURRENCY ?? 25);
assert(Number.isInteger(operations) && operations >= 100 && operations <= 20000);
assert(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 100);
const prefix = `krow_validation_${randomUUID().replaceAll('-', '')}`;
const restoredName = `${prefix}_restore`;
const output = resolve(root, 'artifacts/runtime-local');
await mkdir(output, { recursive: true });
const admin = new pg.Pool({ connectionString: url.toString(), max: 2 });
let db, restored;
const report = { startedAt: new Date().toISOString(), scope: 'local PostgreSQL only; no HTTP, Kafka, Redis, mobile or SLO certification', operations, concurrency, checks: {} };
const run = promisify(execFile);
const pgBin = process.env.PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '/usr/bin');
const executable = name => join(pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const createRuntime = name => {
  const connection = new URL(url); connection.pathname = `/${name}`;
  return new RuntimeDatabase(new ConfigService({ RIDE_RUNTIME_ENABLED: 'true', RUNTIME_DATABASE_URL: connection.toString() }));
};
const fingerprint = async database => {
  const tables = await database.query("select table_schema,table_name from information_schema.tables where table_schema in ('public','krow_runtime') and table_type='BASE TABLE' order by 1,2");
  const hash = createHash('sha256'); const counts = {};
  for (const { table_schema: schema, table_name: table } of tables) {
    assert(/^[a-z_]+$/.test(schema) && /^[a-z_]+$/.test(table));
    const rows = await database.query(`select row_to_json(t)::text value from "${schema}"."${table}" t order by row_to_json(t)::text`);
    counts[`${schema}.${table}`] = rows.length;
    hash.update(`${schema}.${table}\n`);
    for (const row of rows) hash.update(`${row.value}\n`);
  }
  return { sha256: hash.digest('hex'), counts };
};
try {
  await admin.query(`create database ${prefix}`);
  db = createRuntime(prefix);
  for (const path of ['apps/api/test/runtime-baseline.sql', 'supabase/migrations/20260928170611_ride_runtime_v2.sql', 'scripts/runtime-role.sql'])
    await db.query(await readFile(resolve(root, path), 'utf8'));
  const service = new RuntimeService(db);
  const rides = [];
  for (let i = 0; i < 50; i++) {
    const driver = randomUUID(), profile = randomUUID(), vehicle = randomUUID(), ride = randomUUID(), stops = [randomUUID(), randomUUID(), randomUUID()];
    await db.query('insert into public.users values($1)', [driver]);
    await db.query('insert into public.driver_profiles values($1,$2)', [profile,driver]);
    await db.query('insert into public.vehicles values($1,$2,3)', [vehicle,profile]);
    await db.query('insert into public.rides(ride_id,driver_id,vehicle_id,available_seats) values($1,$2,$3,2)', [ride,profile,vehicle]);
    for (const [index,stop] of stops.entries()) {
      await db.query('insert into public.transport_stops(stop_id) values($1)', [stop]);
      await db.query('insert into public.ride_stops values($1,$2,$1,$3,19,-99,$4,true,1)', [stop,ride,index+1,`Local stop ${index+1}`]);
    }
    await service.enroll(driver,ride);
    rides.push({ driver,ride,stops });
  }
  const passengers = Array.from({ length: operations }, () => randomUUID());
  await db.query('insert into public.users select unnest($1::uuid[])', [passengers]);
  let cursor = 0;
  const latencies = [], bookings = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < operations) {
      const index = cursor++, ride = rides[index % rides.length], actor = passengers[index];
      const command = { commandId: randomUUID(), pickupStopId: ride.stops[0], dropoffStopId: ride.stops[2], seats: 1 };
      const before = performance.now();
      const result = await service.requestBooking(actor,ride.ride,command);
      latencies.push(performance.now()-before);
      bookings[index] = { actor, ride, command, result };
    }
  }));
  const elapsedMs = performance.now()-start;
  latencies.sort((a,b) => a-b);
  const percentile = p => Number(latencies[Math.ceil(latencies.length*p)-1].toFixed(2));
  report.load = { elapsedMs: Math.round(elapsedMs), operationsPerSecond: Number((operations*1000/elapsedMs).toFixed(2)), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), errors: 0 };
  const replay = bookings[0];
  const duplicates = await Promise.all(Array.from({ length: 20 }, () => service.requestBooking(replay.actor,replay.ride.ride,replay.command)));
  assert(duplicates.every(value => value.bookingId === replay.result.bookingId));
  assert.equal(Number((await db.query('select count(*) from public.bookings'))[0].count), operations);
  report.checks.duplicateRequests = '20 concurrent replays; one booking';
  for (const ride of rides) {
    const candidates = bookings.filter(value => value.ride.ride === ride.ride).slice(0,3);
    for (const [index,value] of candidates.entries()) {
      const command = { commandId: randomUUID(), expectedVersion: (await service.snapshot(ride.driver,ride.ride)).version, action: 'accept_booking', bookingId: value.result.bookingId };
      if (index < 2) {
        const result = await service.command(ride.driver,ride.ride,command);
        assert.deepEqual(await service.command(ride.driver,ride.ride,command), result);
      } else await assert.rejects(service.command(ride.driver,ride.ride,command));
    }
  }
  report.checks.capacity = '50 rides; two seats accepted, third rejected; committed commands replayed idempotently';
  await db.query('create table public.recovery_probe(id integer primary key)');
  const client = await db.getPool().connect();
  client.on('error', () => {});
  await client.query('begin');
  await client.query('insert into public.recovery_probe values(1)');
  const pid = (await client.query('select pg_backend_pid() pid')).rows[0].pid;
  await admin.query('select pg_terminate_backend($1)', [pid]);
  await assert.rejects(client.query('commit'));
  client.release(true);
  assert.equal((await db.query('select * from public.recovery_probe')).length, 0);
  assert.equal((await service.snapshot(rides[0].driver,rides[0].ride)).state,'scheduled');
  report.checks.connectionLoss = 'Terminated real PostgreSQL connection: uncommitted row rolled back; pool and ride session recovered';
  const before = await fingerprint(db);
  const backup = join(output,'runtime-local.dump');
  const connection = new URL(url); connection.pathname = `/${prefix}`;
  await run(executable('pg_dump'), ['--format=custom','--no-owner','--file',backup,connection.toString()]);
  await admin.query(`create database ${restoredName}`);
  const restoreUrl = new URL(url); restoreUrl.pathname = `/${restoredName}`;
  const recoveryStart = performance.now();
  await run(executable('pg_restore'), ['--exit-on-error','--no-owner','--dbname',restoreUrl.toString(),backup]);
  restored = createRuntime(restoredName);
  const after = await fingerprint(restored);
  assert.deepEqual(after,before);
  report.recovery = { restoreAndVerifyMs: Math.round(performance.now()-recoveryStart), ...after, kind: 'logical backup restoration, not PITR or regional failover' };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  await db?.onModuleDestroy(); await restored?.onModuleDestroy();
  for (const name of [prefix,restoredName]) await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
