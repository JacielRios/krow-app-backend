import { jest } from '@jest/globals';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import type { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { PilotDatabase } from '../../pilot/pilot.database.js';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';

describe('pilot authentication and closed accounts', () => {
  const id = randomUUID();
  const setup = (
    profile: { is_active: boolean | null; deleted_at: Date | null } | null,
    expired = false,
  ) => {
    const getUser = jest.fn(() =>
      Promise.resolve({
        data: {
          user: expired
            ? null
            : {
                id,
                email: 'test@example.invalid',
                user_metadata: { role: 'admin' },
                app_metadata: {},
              },
        },
        error: expired ? { message: 'expired' } : null,
      }),
    );
    const query = jest.fn(() => Promise.resolve(profile ? [profile] : []));
    const guard = new SupabaseAuthGuard(
      { getUser } as unknown as SupabaseService,
      { enabled: true, query } as unknown as PilotDatabase,
    );
    const req: {
      header: (name: string) => string | undefined;
      user?: AuthenticatedUser;
    } = { header: () => 'Bearer verified-token' };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { guard, req, context, query };
  };
  it('derives the actor from the verified token and reads account flags through the private role', async () => {
    const { guard, context, req, query } = setup({
      is_active: true,
      deleted_at: null,
    });
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.user?.id).toBe(id);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where uuid=$1'),
      [id],
    );
  });
  it.each([
    { is_active: false, deleted_at: null },
    { is_active: true, deleted_at: new Date() },
  ])(
    'refuses an inactive or deleted profile despite a still valid JWT',
    async (profile) => {
      const { guard, context, req } = setup(profile);
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(req.user).toBeUndefined();
    },
  );
  it('rejects expired tokens before querying profile data', async () => {
    const { guard, context, query } = setup(null, true);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
