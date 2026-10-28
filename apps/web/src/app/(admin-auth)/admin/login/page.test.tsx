import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  verifyAdmin: vi.fn(),
  verifyDriver: vi.fn(),
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
vi.mock('@/lib/admin-auth', () => ({ verifyAdminSession: mocks.verifyAdmin }));
vi.mock('@/lib/driver-auth', () => ({
  verifyDriverSession: mocks.verifyDriver,
}));

import LoginPage from './page';

const session = { access_token: 'test-access' };

describe('login de administrador y conductor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue({ data: { session }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.verifyAdmin.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.verifyDriver.mockResolvedValue({ driver_id: 'driver' });
  });

  function chooseRole(name: 'Administrador' | 'Conductor') {
    fireEvent.click(screen.getByRole('tab', { name }));
  }

  function submit() {
    fireEvent.change(screen.getByLabelText('Correo'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  }

  it('abre con Administrador activo por defecto', () => {
    render(<LoginPage />);
    expect(screen.getByRole('tab', { name: 'Administrador' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Conductor' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(
      screen.getByText('Usa tu cuenta autorizada para gestionar la operación.'),
    ).toBeInTheDocument();
  });

  it('cambia el texto al seleccionar Conductor', () => {
    render(<LoginPage />);
    chooseRole('Conductor');
    expect(
      screen.getByText('Inicia sesión para ver tus viajes, ganancias y pagos.'),
    ).toBeInTheDocument();
  });

  it('verifica la autoridad de administrador antes de navegar', async () => {
    render(<LoginPage />);
    submit();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/admin/dashboard'),
    );
    expect(mocks.verifyAdmin).toHaveBeenCalledWith(session);
    expect(mocks.verifyDriver).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'test-password',
    });
  });

  it('verifica la cuenta de conductor antes de navegar', async () => {
    render(<LoginPage />);
    chooseRole('Conductor');
    submit();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/driver/dashboard'),
    );
    expect(mocks.verifyDriver).toHaveBeenCalledWith(session);
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
  });

  it('cierra sesión de un usuario común y permite reintentar', async () => {
    mocks.verifyAdmin.mockRejectedValue(
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

  it('cierra sesión si la cuenta no es de un conductor activo', async () => {
    mocks.verifyDriver.mockRejectedValue(
      new Error('Esta cuenta no es de un conductor registrado y activo.'),
    );
    render(<LoginPage />);
    chooseRole('Conductor');
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'no es de un conductor registrado y activo',
      ),
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('no revela si una cuenta existe', async () => {
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
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.verifyDriver).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('limpia el error al cambiar de rol', async () => {
    mocks.signIn.mockResolvedValue({
      data: { session: null },
      error: { message: 'x' },
    });
    render(<LoginPage />);
    submit();
    await screen.findByRole('alert');
    chooseRole('Conductor');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
