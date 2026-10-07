import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ useAdminAuth: mocks.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/conductores' }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import { AdminShell } from './AdminShell';
describe('administrative access shell', () => {
  beforeEach(() => {
    mocks.signOut.mockResolvedValue(undefined);
    mocks.auth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signOut: mocks.signOut,
    });
  });
  it('withholds all operational content before authorization succeeds', () => {
    render(
      <AdminShell>
        <p>Protected driver data</p>
      </AdminShell>,
    );
    expect(screen.queryByText('Protected driver data')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Iniciar sesión' }),
    ).toHaveAttribute('href', '/admin/login');
  });
  it('shows recovery when permission is rejected', () => {
    mocks.auth.mockReturnValue({
      user: null,
      loading: false,
      error: 'Sin permisos administrativos',
      signOut: mocks.signOut,
    });
    render(
      <AdminShell>
        <p>Protected driver data</p>
      </AdminShell>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sin permisos administrativos',
    );
    expect(screen.queryByText('Protected driver data')).not.toBeInTheDocument();
  });
  it('exposes accessible navigation and logs out explicitly', () => {
    mocks.auth.mockReturnValue({
      user: { id: 'admin', email: 'admin@example.com' },
      loading: false,
      error: null,
      signOut: mocks.signOut,
    });
    render(
      <AdminShell>
        <p>Protected driver data</p>
      </AdminShell>,
    );
    expect(screen.getByText('Protected driver data')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conductores' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
    expect(screen.getByRole('button', { name: 'Menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
