import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resource: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/lib/admin-api', () => ({
  useAdminApi: () => mocks.request,
  useAdminResource: mocks.resource,
}));
import DriversPage from './page';
const driver = {
  driverId: 'driver-1',
  userId: 'user-1',
  fullName: 'Ana Test',
  email: 'ana@example.com',
  institutionalId: '123',
  status: 'active',
  approvalStatus: 'approved',
  licenseNumber: 'NL123',
  licenseExpiresAt: '2030-01-01',
  rating: 4.5,
  vehicleCount: 1,
  compliance: { state: 'ready', reasons: [] },
};
describe('driver administration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    mocks.resource.mockImplementation((path: string) => ({
      data:
        path === '/admin/drivers/driver-1'
          ? { ...driver, vehicles: [], documents: [] }
          : { items: [driver], total: 61, page: 1, pageSize: 20 },
      loading: false,
      error: null,
      reload: mocks.reload,
    }));
    mocks.request.mockResolvedValue({});
  });
  it('paginates on the server, preserving historical access beyond the first page', () => {
    render(<DriversPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(mocks.resource.mock.calls.at(-1)?.[0]).toContain('page=2');
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: 'inactive' },
    });
    expect(mocks.resource.mock.calls.at(-1)?.[0]).toContain(
      'status=inactive&page=1',
    );
  });
  it('requires an explicit confirmation before suspending a driver', async () => {
    render(<DriversPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }));
    expect(mocks.request).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Nuevo estado'), {
      target: { value: 'suspended' },
    });
    fireEvent.change(dialog.getByLabelText(/Motivo/), {
      target: { value: 'Licencia en revisión' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Confirmar cambio' }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        '/admin/drivers/driver-1/status',
        {
          method: 'PATCH',
          body: { status: 'suspended', reason: 'Licencia en revisión' },
        },
      ),
    );
    expect(mocks.reload).toHaveBeenCalledOnce();
  });
  it('creates a driver profile for an existing account without creating an admin role', async () => {
    render(<DriversPage />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Dar de alta conductor' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Correo de la cuenta'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(dialog.getByLabelText('Número de licencia'), {
      target: { value: 'NL456' },
    });
    fireEvent.change(dialog.getByLabelText('Vencimiento de licencia'), {
      target: { value: '2031-01-01' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/admin/drivers', {
        method: 'POST',
        body: {
          email: 'new@example.com',
          licenseNumber: 'NL456',
          licenseExpiresAt: '2031-01-01',
        },
      }),
    );
  });
});
