import { fireEvent, render, screen } from '@testing-library/react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import DriverDashboard from './DriverDashboard';
import { money, rangeFromDays, type DriverDashboardData } from './driver-data';

const { resource, reload } = vi.hoisted(() => ({
  resource: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/lib/driver-api', () => ({
  useDriverResource: (path: string) => resource(path),
}));

const data: DriverDashboardData = {
  completed: 5,
  cancelled: 1,
  ongoing: 2,
  scheduled: 4,
  totalTrips: 12,
  passengers: 7,
  occupancy: 55,
  revenue: 134.75,
  paid: 45.25,
  pending: 89.5,
  timezone: 'America/Monterrey',
  currency: 'MXN',
  trend: [{ date: '2026-10-07', completed: 5, cancelled: 1, revenue: 134.75 }],
  topRoutes: [{ route: 'ITNL → Centro', trips: 5, occupancy: 55, revenue: 134.75 }],
};
const empty: DriverDashboardData = {
  ...data,
  completed: 0,
  cancelled: 0,
  ongoing: 0,
  scheduled: 0,
  totalTrips: 0,
  passengers: 0,
  occupancy: 0,
  revenue: 0,
  paid: 0,
  pending: 0,
  trend: [],
  topRoutes: [],
};
const state = (
  value: DriverDashboardData | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data: value, loading: false, error: null, reload, ...extra });

describe('dashboard del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
  });

  it('consulta su resumen del último mes y muestra los importes con centavos', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    const month = rangeFromDays(30);
    expect(resource).toHaveBeenCalledWith(
      `/drivers/me/dashboard-summary?from=${month.from}&to=${month.to}`,
    );
    expect(screen.getByRole('button', { name: '1 mes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByText(money(134.75))).toHaveLength(2);
    expect(screen.getByText(money(45.25))).toBeVisible();
    expect(screen.getByText(money(89.5))).toBeVisible();
    expect(
      screen.getByText('Pasajeros transportados').closest('article'),
    ).toHaveTextContent('7');
    expect(
      screen.queryByRole('heading', { name: 'Conductores' }),
    ).not.toBeInTheDocument();
  });

  it('cambia de periodo con Semana y 3 meses', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    let selected = rangeFromDays(7);
    expect(resource).toHaveBeenLastCalledWith(
      `/drivers/me/dashboard-summary?from=${selected.from}&to=${selected.to}`,
    );
    fireEvent.click(screen.getByRole('button', { name: '3 meses' }));
    selected = rangeFromDays(90);
    expect(resource).toHaveBeenLastCalledWith(
      `/drivers/me/dashboard-summary?from=${selected.from}&to=${selected.to}`,
    );
  });

  it('muestra el estado de carga inicial', () => {
    resource.mockReturnValue(state(null, { loading: true }));
    render(<DriverDashboard />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando indicadores');
  });

  it('presenta el error y permite reintentar sin datos de ejemplo', () => {
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<DriverDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('admite periodos vacíos sin NaN ni gráfica', () => {
    resource.mockReturnValue(state(empty));
    render(<DriverDashboard />);
    expect(screen.getByText(/No hay viajes en este periodo/)).toBeVisible();
    expect(
      screen.getByText('No hay rutas con actividad en este periodo.'),
    ).toBeVisible();
    expect(screen.queryByText('Viajes por día')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('no inventa cobros cuando no hay registro de efectivo', () => {
    resource.mockReturnValue(state({ ...data, paid: null, pending: null }));
    render(<DriverDashboard />);
    expect(screen.getAllByText('Sin registro')).toHaveLength(2);
  });

  it('enlaza al historial de viajes realizados', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    expect(
      screen.getByRole('link', { name: /historial de viajes realizados/i }),
    ).toHaveAttribute('href', '/conductor/viajes');
  });
});
