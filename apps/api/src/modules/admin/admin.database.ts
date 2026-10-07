import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { PilotDatabase } from '../pilot/pilot.database.js';

// Uses the existing private API connection. Authorization is refreshed by the
// AuthGuard and checked again against the authoritative Auth record in SQL.
export async function adminTransaction<T>(
  db: PilotDatabase,
  user: AuthenticatedUser,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (user.appMetadata.role !== 'admin')
    throw new ForbiddenException('Acceso administrativo requerido');
  try {
    return await db.transaction(async (client) => {
      await client.query("set local time zone 'America/Monterrey'");
      await client.query(
        "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
        [
          JSON.stringify({
            sub: user.id,
            role: 'authenticated',
            app_metadata: { role: 'admin' },
          }),
          user.id,
        ],
      );
      const { rows } = await client.query<{ allowed: boolean }>(
        'select private.is_admin_actor() as allowed',
      );
      if (!rows[0]?.allowed)
        throw new ForbiddenException('Acceso administrativo requerido');
      return work(client);
    });
  } catch (error: unknown) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : '';
    if (code === '23505')
      throw new ConflictException(
        'Estos datos ya están registrados. Actualiza e intenta nuevamente.',
      );
    if (['23503', '23514', '22003', '22P02', '22007'].includes(code))
      throw new BadRequestException(
        'Los datos no son válidos para esta operación.',
      );
    if (['40001', '40P01'].includes(code))
      throw new ConflictException(
        'Los datos cambiaron durante la operación. Actualiza e intenta nuevamente.',
      );
    if (['55P03', '57014'].includes(code))
      throw new ServiceUnavailableException(
        'La operación está ocupada. Intenta nuevamente.',
      );
    throw error;
  }
}
