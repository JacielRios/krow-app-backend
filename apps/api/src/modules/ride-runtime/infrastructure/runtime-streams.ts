import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Producer, type Consumer } from 'kafkajs';
import { createClient } from 'redis';

@Injectable()
export class RuntimeStreams implements OnModuleDestroy {
  private redisClient?: ReturnType<typeof createClient>;
  private redisPromise?: Promise<ReturnType<typeof createClient>>;
  private producerPromise?: Promise<Producer>;
  private consumers: Consumer[] = [];
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<string>('RIDE_RUNTIME_ENABLED') === 'true';
  }
  get worker() {
    return this.config.get<string>('RIDE_RUNTIME_PROCESS') === 'worker';
  }
  topic(kind: 'locations' | 'business') {
    return `${this.config.get<string>('RUNTIME_TOPIC_PREFIX', 'krow')}.${kind}.v2`;
  }
  redis() {
    if (this.redisClient?.isReady) return Promise.resolve(this.redisClient);
    if (!this.redisPromise && this.redisClient?.isOpen)
      return Promise.reject(
        new ServiceUnavailableException('El seguimiento se está reconectando'),
      );
    if (!this.redisPromise) {
      const url = this.config.getOrThrow<string>('RUNTIME_REDIS_URL');
      if (
        this.config.get('NODE_ENV') === 'production' &&
        !url.startsWith('rediss://')
      )
        throw new Error('Redis requiere TLS');
      this.redisClient = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 3000,
          reconnectStrategy: (retries) =>
            retries < 3 ? Math.min(retries * 100, 3000) : false,
        },
      });
      this.redisClient.on('error', () => {});
      const client = this.redisClient;
      this.redisPromise = client
        .connect()
        .then(() => client)
        .catch(() => {
          if (client.isOpen) client.destroy();
          if (this.redisClient === client) this.redisClient = undefined;
          throw new ServiceUnavailableException(
            'El seguimiento está temporalmente indisponible',
          );
        })
        .finally(() => {
          this.redisPromise = undefined;
        });
    }
    return this.redisPromise;
  }
  private kafka() {
    const production = this.config.get('NODE_ENV') === 'production';
    const username = this.config.get<string>('RUNTIME_KAFKA_USERNAME');
    const password = this.config.get<string>('RUNTIME_KAFKA_PASSWORD');
    if (production && (!username || !password))
      throw new Error('Kafka requiere credenciales de servicio');
    return new Kafka({
      clientId: 'krow-runtime',
      brokers: this.config
        .getOrThrow<string>('RUNTIME_KAFKA_BROKERS')
        .split(','),
      ssl: production,
      sasl:
        username && password
          ? { mechanism: 'scram-sha-512', username, password }
          : undefined,
      connectionTimeout: 3000,
      requestTimeout: 10000,
      logLevel: logLevel.NOTHING,
      retry: { retries: 3 },
    });
  }
  async createSubscriber() {
    // Pub/sub must reconnect for the process lifetime; request connections fail fast.
    const subscriber = (await this.redis()).duplicate({
      socket: {
        reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 3000),
      },
    });
    subscriber.on('error', () => undefined);
    return subscriber;
  }
  async producer() {
    if (!this.producerPromise) {
      const producer = this.kafka().producer({
        idempotent: true,
        maxInFlightRequests: 1,
        allowAutoTopicCreation: false,
      });
      this.producerPromise = producer
        .connect()
        .then(() => producer)
        .catch((error) => {
          this.producerPromise = undefined;
          throw error;
        });
    }
    return this.producerPromise;
  }
  async publish(kind: 'locations' | 'business', rideId: string, value: object) {
    const producer = await this.producer();
    await producer.send({
      topic: this.topic(kind),
      acks: -1,
      messages: [{ key: rideId, value: JSON.stringify(value) }],
    });
  }
  async consume(
    kind: 'locations' | 'business',
    handler: (value: unknown) => Promise<void>,
  ) {
    const consumer = this.kafka().consumer({
      groupId: `krow-${kind}-v2`,
      allowAutoTopicCreation: false,
    });
    this.consumers.push(consumer);
    await consumer.connect();
    await consumer.subscribe({
      topic: this.topic(kind),
      fromBeginning: kind === 'business',
    });
    await consumer.run({
      partitionsConsumedConcurrently: 8,
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        await handler(JSON.parse(message.value.toString()) as unknown);
      },
    });
  }
  async onModuleDestroy() {
    for (const consumer of this.consumers) await consumer.disconnect();
    if (this.producerPromise) await (await this.producerPromise).disconnect();
    if (this.redisClient?.isOpen) this.redisClient.destroy();
  }
}
