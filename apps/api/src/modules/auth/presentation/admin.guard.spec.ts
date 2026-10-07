import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';

const context = (user?: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;
describe('AdminGuard', () => {
  const guard = new AdminGuard();
  it('requires authentication and an administrator role in trusted appMetadata', () => {
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        context({ appMetadata: {}, userMetadata: { role: 'admin' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(context({ appMetadata: { role: 'passenger' } })),
    ).toThrow(ForbiddenException);
    expect(guard.canActivate(context({ appMetadata: { role: 'admin' } }))).toBe(
      true,
    );
  });
});
