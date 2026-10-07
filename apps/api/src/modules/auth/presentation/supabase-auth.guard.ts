import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { PilotDatabase } from '../../pilot/pilot.database.js';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly pilot?: PilotDatabase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Token faltante');

    const accessToken = authorization.slice('Bearer '.length).trim();
    const { data, error } = await this.supabase.getUser(accessToken);
    if (error || !data.user)
      throw new UnauthorizedException('Token inválido o expirado');

    let profile: {
      is_active: boolean | null;
      deleted_at: string | Date | null;
    } | null;
    if (this.pilot?.enabled)
      profile =
        (
          await this.pilot.query<{
            is_active: boolean | null;
            deleted_at: Date | null;
          }>('select is_active,deleted_at from public.users where uuid=$1', [
            data.user.id,
          ])
        )[0] ?? null;
    else {
      const result = await this.supabase
        .forUser(accessToken)
        .from('users')
        .select('is_active, deleted_at')
        .eq('uuid', data.user.id)
        .maybeSingle();
      if (result.error)
        throw new UnauthorizedException('No se pudo verificar la cuenta');
      profile = result.data;
    }
    if (profile?.is_active === false || profile?.deleted_at)
      throw new ForbiddenException('Esta cuenta está desactivada');

    request.user = {
      id: data.user.id,
      email: data.user.email ?? null,
      accessToken,
      userMetadata: data.user.user_metadata,
      appMetadata: data.user.app_metadata,
    };
    return true;
  }
}
