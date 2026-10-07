import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

@Injectable()
export class RuntimeDatabase implements OnModuleDestroy {
  private pool?: pg.Pool;
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<string>('RIDE_RUNTIME_ENABLED') === 'true';
  }
  getPool(): pg.Pool {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        'El seguimiento v2 no está habilitado',
      );
    if (!this.pool) {
      const connectionString = this.config.getOrThrow<string>(
        'RUNTIME_DATABASE_URL',
      );
      const production = this.config.get('NODE_ENV') === 'production';
      if (production && !this.config.get<string>('RUNTIME_DATABASE_CA'))
        throw new Error('RUNTIME_DATABASE_CA es obligatoria en producción');
      this.pool = new pg.Pool({
        connectionString,
        max: 20,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,
        application_name: 'krow-runtime',
        ssl: production
          ? {
              rejectUnauthorized: true,
              ca: this.config
                .get<string>('RUNTIME_DATABASE_CA')
                ?.replace(/\\n/g, '\n'),
            }
          : undefined,
      });
      this.pool.on('error', () => {
        /* errors are surfaced by readiness and operations; never log credentials */
      });
    }
    return this.pool;
  }
  async query<T extends QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.getPool().query<T>(sql, values)).rows;
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    let unusable = false;
    try {
      await client.query('begin');
      await client.query("set local lock_timeout='3s'");
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the business/connection error and discard a broken connection.
        unusable = true;
      }
      throw error;
    } finally {
      client.release(unusable);
    }
  }
  async onModuleDestroy() {
    await this.pool?.end();
  }
}
