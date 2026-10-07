import { Kafka, logLevel } from 'kafkajs';

const production = process.env.NODE_ENV === 'production';
const brokers = process.env.RUNTIME_KAFKA_BROKERS?.split(',');
if (!brokers?.length) throw new Error('RUNTIME_KAFKA_BROKERS is required');
const username = process.env.RUNTIME_KAFKA_USERNAME,
  password = process.env.RUNTIME_KAFKA_PASSWORD;
if (production && (!username || !password))
  throw new Error('Production requires Kafka SCRAM credentials');
const admin = new Kafka({
  clientId: 'krow-topic-provisioner',
  brokers,
  ssl: production,
  sasl:
    username && password
      ? { mechanism: 'scram-sha-512', username, password }
      : undefined,
  logLevel: logLevel.NOTHING,
}).admin();
const prefix = process.env.RUNTIME_TOPIC_PREFIX ?? 'krow';
await admin.connect();
try {
  const existing = new Set(await admin.listTopics());
  const topics = ['locations', 'business'].map((kind) => ({
    topic: `${prefix}.${kind}.v2`,
    numPartitions: 64,
    replicationFactor: production ? 3 : 1,
    configEntries: [
      { name: 'min.insync.replicas', value: production ? '2' : '1' },
      {
        name: 'retention.ms',
        value: String((kind === 'locations' ? 30 : 180) * 86400000),
      },
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'unclean.leader.election.enable', value: 'false' },
    ],
  }));
  // Existing topics are inspected below, never silently reduced/repartitioned.
  await admin.createTopics({
    waitForLeaders: true,
    topics: topics.filter((t) => !existing.has(t.topic)),
  });
  const metadata = await admin.fetchTopicMetadata({
    topics: topics.map((t) => t.topic),
  });
  for (const topic of metadata.topics) {
    if (
      topic.partitions.length !== 64 ||
      topic.partitions.some((p) => p.replicas.length < (production ? 3 : 1))
    )
      throw new Error(`Topic requires operator review: ${topic.name}`);
  }
  console.log(
    'Runtime topics present; 64 partitions verified. Review broker encryption, ACLs and retention before release.',
  );
} finally {
  await admin.disconnect();
}
