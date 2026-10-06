import { createServer } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { RuntimeStreams } from './runtime-streams.js';

describe('Redis unavailable locally', () => {
  it('fails within a bounded interval and permits another connection attempt', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local port');
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const streams = new RuntimeStreams(
      new ConfigService({
        RUNTIME_REDIS_URL: `redis://127.0.0.1:${address.port}`,
      }),
    );
    try {
      const first = streams.redis();
      await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException);
      const retry = streams.redis();
      expect(retry).not.toBe(first);
      await expect(retry).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await streams.onModuleDestroy();
    }
  }, 10000);
});
