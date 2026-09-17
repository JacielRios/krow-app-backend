import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';

@Injectable()
export class MapsRateLimitGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const key = request.user?.id ?? request.ip ?? 'unknown';
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= 60)
      throw new HttpException('Límite temporal de mapas excedido', 429);
    current.count += 1;
    return true;
  }
}
