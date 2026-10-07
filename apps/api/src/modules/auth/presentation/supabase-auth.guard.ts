import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

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
