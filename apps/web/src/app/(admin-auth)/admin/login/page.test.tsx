import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  verify: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/lib/admin-supabase', () => ({
  getAdminSupabase: () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
  }),
}));
vi.mock('@/lib/admin-auth', () => ({ verifyAdminSession: mocks.verify }));
import LoginPage from './page';
describe('administrator login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue({
      data: { session: { access_token: 'test-access' } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({ id: 'admin', role: 'admin' });
  });
  function submit() {
    fireEvent.change(screen.getByLabelText('Correo'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  }
  it('checks backend administrator authority before navigating', async () => {
    render(<LoginPage />);
    submit();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/admin/dashboard'),
    );
    expect(mocks.verify).toHaveBeenCalledWith({ access_token: 'test-access' });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'test-password',
    });
  });
  it('signs out a valid ordinary user and keeps the login recoverable', async () => {
    mocks.verify.mockRejectedValue(
      new Error('Esta cuenta no tiene permisos administrativos.'),
    );
    render(<LoginPage />);
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'no tiene permisos administrativos',
      ),
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });
  it('does not reveal whether an authentication account exists', async () => {
    mocks.signIn.mockResolvedValue({
      data: { session: null },
      error: { message: 'User not found' },
    });
    render(<LoginPage />);
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Revisa tu correo y contraseña',
      ),
    );
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
