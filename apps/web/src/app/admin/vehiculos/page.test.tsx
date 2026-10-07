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
import VehiclesPage from './page';
const vehicle = {
  vehicleId: 'vehicle-1',
  driverId: 'driver-1',
  driverName: 'Ana Test',
  plate: 'NL123',
  brand: 'Toyota',
  model: 'Yaris',
  year: 2024,
  color: 'Azul',
  capacity: 4,
  status: 'active',
  isActive: true,
  compliance: { state: 'ready', reasons: [] },
};
describe('vehicle administration contract', () => {
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
      data: {
        items: path.startsWith('/admin/drivers')
          ? [
              {
                driverId: 'driver-1',
                fullName: 'Ana Test',
                email: 'ana@example.com',
              },
            ]
          : [vehicle],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      loading: false,
      error: null,
      reload: mocks.reload,
    }));
    mocks.request.mockResolvedValue({});
  });
  it('updates allowed vehicle fields without reassigning historical ownership', async () => {
    render(<VehiclesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar / editar' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Color'), {
      target: { value: 'Blanco' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/admin/vehicles/vehicle-1', {
        method: 'PATCH',
        body: {
          plate: 'NL123',
          brand: 'Toyota',
          model: 'Yaris',
          year: 2024,
          color: 'Blanco',
          capacity: 4,
          status: 'active',
        },
      }),
    );
  });
  it('requires confirmation before withdrawing an active unit', async () => {
    render(<VehiclesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar / editar' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Estado'), {
      target: { value: 'inactive' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Confirmar cambio' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.request.mock.calls[0][1].body.status).toBe('inactive');
  });
});
