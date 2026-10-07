import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg, { type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class PilotDatabase implements OnModuleDestroy {
  private pool?: pg.Pool;
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<string>('RIDE_PILOT_ENABLED') === 'true';
  }
  get trackingEnabled() {
    return (
      this.enabled &&
      this.config.get<string>('RIDE_TRACKING_ENABLED') === 'true'
    );
  }
  get closureEnabled() {
    return (
      this.enabled &&
      this.config.get<string>('PILOT_ACCOUNT_CLOSURE_ENABLED') === 'true'
    );
  }
  getPool() {
    if (!this.enabled)
      throw new ServiceUnavailableException('El piloto no está habilitado');
    if (!this.pool) {
      const production = this.config.get('NODE_ENV') === 'production';
      this.pool = new pg.Pool({
        connectionString: this.config.getOrThrow<string>('PILOT_DATABASE_URL'),
        max: 10,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        application_name: 'krow-pilot',
        ssl: production
          ? {
              rejectUnauthorized: true,
              ca: this.config
                .getOrThrow<string>('PILOT_DATABASE_CA')
                .replace(/\\n/g, '\n'),
            }
          : undefined,
      });
      this.pool.on('error', () => {
        /* query failures surface through readiness */
      });
    }
    return this.pool;
  }
  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return (await this.getPool().query<T>(sql, values)).rows;
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.getPool().connect();
    let broken = false;
    try {
      await client.query('begin');
      await client.query("set local lock_timeout = '3s'");
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error: unknown) {
      try {
        await client.query('rollback');
      } catch {
        broken = true;
      }
      if (error instanceof Error) throw error;
      throw new Error('No se pudo completar la operación de base de datos');
    } finally {
      client.release(broken);
    }
  }
  // Function name comes only from this allowlist. JWT claims preserve auth.uid()
  // and existing ownership checks while execution stays on the private API role.
  async routeRpc(
    actorId: string,
    name:
      | 'create_ride_v2'
      | 'update_ride_v2'
      | 'upsert_favorite_route'
      | 'request_booking_v2'
      | 'delete_favorite_route',
    values: unknown[],
  ) {
    try {
      return await this.transaction(async (client) => {
        const { rows } = await client.query<{
          is_active: boolean | null;
          deleted_at: Date | null;
        }>(
          'select is_active,deleted_at from public.users where uuid=$1 for update',
          [actorId],
        );
        if (!rows[0] || rows[0].is_active === false || rows[0].deleted_at)
          throw new ForbiddenException('La cuenta no está disponible');
        await client.query(
          "select set_config('request.jwt.claims', $1, true)",
          [JSON.stringify({ sub: actorId, role: 'authenticated' })],
        );
        await client.query(
          "select set_config('request.jwt.claim.sub', $1, true)",
          [actorId],
        );
        const placeholders = values
          .map((_, index) => `$${index + 1}`)
          .join(',');
        const result = await client.query<{ value: string | number }>(
          `select public.${name}(${placeholders}) as value`,
          values,
        );
        return result.rows[0].value;
      });
    } catch (error: unknown) {
      // Private pg execution does not perform PostgREST's HTTP mapping. Only
      // deliberate business exceptions expose their short user-facing message;
      // SQL details, constraint names and infrastructure failures stay private.
      if (typeof error !== 'object' || error === null || !('code' in error))
        throw error;
      const code: unknown = error.code;
      if (
        code === 'P0001' &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        const message = error.message;
        if (message === 'No autenticado')
          throw new UnauthorizedException(message);
        if (
          /perfil de conductor aprobado|No puedes reservar tu propio viaje/.test(
            message,
          )
        )
          throw new ForbiddenException(message);
        if (/no encontrado|no encontrada|no existe/.test(message))
          throw new NotFoundException(message);
        if (
          /Conflicto de version|ya no se puede editar|reservas activas|Ya tienes una reservacion activa|no acepta reservaciones|No hay suficientes asientos/.test(
            message,
          )
        )
          throw new ConflictException(message);
        throw new BadRequestException(message);
      }
      if (code === '23505')
        throw new ConflictException(
          'Estos datos ya están registrados. Actualiza e intenta nuevamente.',
        );
      if (['23503', '23514', '22003', '22P02'].includes(String(code)))
        throw new BadRequestException(
          'Los datos enviados no son válidos para esta operación.',
        );
      if (['40001', '40P01'].includes(String(code)))
        throw new ConflictException(
          'La operación coincidió con otro cambio. Actualiza e intenta nuevamente.',
        );
      if (['55P03', '57014'].includes(String(code)))
        throw new ServiceUnavailableException(
          'La operación está ocupada. Intenta nuevamente.',
        );
      if (error instanceof Error) throw error;
      throw new Error('No se pudo completar la operación de base de datos');
    }
  }
  async onModuleDestroy() {
    await this.pool?.end();
  }
}
