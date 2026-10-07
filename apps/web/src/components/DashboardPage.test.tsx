import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';
import { useDashboardData } from './useDashboardData';
import { rangeFromDays } from './DateRangeFilter';
import { dashboardInsights, money, type DashboardData } from './dashboard-data';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/admin-api', () => ({ useAdminApi: () => request }));
vi.mock('./Charts', () => ({
  RevenueChart: () => <div>Gráfica de importes</div>,
  TripsTrendChart: () => <div>Gráfica de viajes</div>,
}));

const data: DashboardData = {
  completed: 5,
  cancelled: 1,
  ongoing: 2,
  scheduled: 4,
  totalTrips: 12,
  activeDrivers: 3,
  inactiveDrivers: 2,
  passengers: 7,
  reservedPassengers: 11,
  occupancy: 55,
  revenue: 134.75,
  paid: 45.25,
  pending: 89.5,
  timezone: 'America/Monterrey',
  currency: 'MXN',
  trend: [{ date: '2026-10-07', completed: 5, cancelled: 1, revenue: 134.75 }],
  topRoutes: [
    { route: 'ITNL → Centro', trips: 5, occupancy: 55, revenue: 134.75 },
  ],
};
const empty: DashboardData = {
  ...data,
  completed: 0,
  cancelled: 0,
  ongoing: 0,
  scheduled: 0,
  totalTrips: 0,
  passengers: 0,
  reservedPassengers: 0,
  occupancy: 0,
  revenue: 0,
  paid: 0,
  pending: 0,
  trend: [],
  topRoutes: [],
};

describe('dashboard con datos reales', () => {
  beforeEach(() => request.mockReset());
  it('consulta la API protegida, conserva centavos y distingue efectivo de importes comprometidos', async () => {
    request.mockResolvedValue(data);
    render(<DashboardPage />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cargando indicadores',
    );
    await screen.findByRole('heading', { name: 'Importes y efectivo' });
    expect(request.mock.calls[0][0]).toMatch(
      /^\/reports\/dashboard-summary\?from=\d{4}-\d{2}-\d{2}&to=/,
    );
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(screen.getAllByText(money(134.75))).toHaveLength(2);
    expect(screen.getByText(money(45.25))).toBeVisible();
    expect(
      screen.getByText('Pasajeros transportados').closest('article'),
    ).toHaveTextContent('7');
    expect(
      screen.getByText('Estado actual del catálogo; no depende de las fechas'),
    ).toBeVisible();
    expect(screen.queryByText('Ingresos')).not.toBeInTheDocument();
  });
  it('presenta error y permite recuperar sin sustituirlo por datos de ejemplo', async () => {
    request
      .mockRejectedValueOnce(new Error('Servicio no disponible'))
      .mockResolvedValueOnce(data);
    render(<DashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servicio no disponible',
    );
    expect(screen.queryByText('142')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: 'Importes y efectivo' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('admite periodos vacíos sin divisiones por cero ni acceso a la primera ruta inexistente', async () => {
    request.mockResolvedValue(empty);
    render(<DashboardPage />);
    await screen.findByText('No hay rutas con actividad en este periodo.');
    expect(screen.getByText(/No hay viajes en este periodo/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.queryByText('Gráfica de viajes')).not.toBeInTheDocument();
  });
  it('vuelve a consultar al elegir otro periodo', async () => {
    request.mockResolvedValue(data);
    render(<DashboardPage />);
    await screen.findByRole('heading', { name: 'Importes y efectivo' });
    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const selected = rangeFromDays(7);
    expect(request.mock.calls[1][0]).toContain(
      `from=${selected.from}&to=${selected.to}`,
    );
  });
  it('no presenta una respuesta de fechas anteriores después de cambiar el filtro', async () => {
    let resolveFirst!: (value: DashboardData) => void;
    let resolveSecond!: (value: DashboardData) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise<DashboardData>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<DashboardData>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { result, rerender } = renderHook(
      ({ from }) => useDashboardData({ from, to: '2026-10-07' }),
      { initialProps: { from: '2026-10-01' } },
    );
    const firstSignal = request.mock.calls[0][1].signal;
    rerender({ from: '2026-10-05' });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveSecond(empty));
    await act(async () => resolveFirst(data));
    expect(result.current.data).toEqual(empty);
  });
  it('conserva contenido durante una actualización del mismo periodo', async () => {
    let resolveRefresh!: (value: DashboardData) => void;
    request.mockResolvedValueOnce(data).mockImplementationOnce(
      () =>
        new Promise<DashboardData>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useDashboardData({ from: '2026-10-01', to: '2026-10-07' }),
    );
    await waitFor(() => expect(result.current.data).toEqual(data));
    act(() => result.current.reload());
    expect(result.current.data).toEqual(data);
    expect(result.current.loading).toBe(true);
    await act(async () => resolveRefresh(empty));
    expect(result.current.data).toEqual(empty);
  });
});

describe('fechas e indicadores', () => {
  it('usa la fecha de Monterrey aunque en UTC ya sea el siguiente día', () => {
    expect(rangeFromDays(7, new Date('2026-10-08T01:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    });
  });
  it('no inventa cobros cuando no hay registro', () => {
    expect(dashboardInsights({ ...data, pending: null })).not.toContain(
      expect.stringContaining('efectivo pendiente'),
    );
    expect(money(10.25)).toContain('10.25');
  });
});
