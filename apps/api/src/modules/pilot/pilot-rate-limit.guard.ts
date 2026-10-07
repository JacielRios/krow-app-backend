import {
  Injectable,
  HttpException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
@Injectable()
export class PilotRateLimitGuard implements CanActivate {
  private windows = new Map<string, { at: number; count: number }>();
  private consume(key: string, limit: number, now: number) {
    if (this.windows.size >= 4096) {
      for (const [k, w] of this.windows)
        if (now - w.at >= 60000) this.windows.delete(k);
      if (this.windows.size >= 4096 && !this.windows.has(key))
        throw new HttpException('Intenta nuevamente en un momento', 429);
    }
    let w = this.windows.get(key);
    if (!w || now - w.at >= 60000) {
      w = { at: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= limit)
      throw new HttpException(
        'Demasiadas solicitudes. Intenta nuevamente en un momento',
        429,
      );
    w.count++;
  }
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<
      Request<Record<string, string>, unknown, unknown> & {
        user?: AuthenticatedUser;
      }
    >();
    const now = Date.now();
    if (req.user) this.consume('actor:' + req.user.id, 120, now);
    else {
      this.consume('ip:' + (req.ip ?? 'unknown'), 600, now);
      const id: unknown =
        typeof req.body === 'object' && req.body !== null
          ? (req.body as { sessionId?: unknown }).sessionId
          : undefined;
      if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
        this.consume('session:' + id, 90, now);
    }
    return true;
  }
}
