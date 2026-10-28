import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import DriverTripHistory from './DriverTripHistory';
import { money, rangeFromDays, type DriverRide } from './driver-data';
import type { DriverPage } from '@/lib/driver-api';

const { resource, reload } = vi.hoisted(() => ({
  resource: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/lib/driver-api', () => ({
  useDriverResource: (path: string) => resource(path),
}));

const page: DriverPage<DriverRide> = {
  items: [
    {
      rideId: 'r1',
      departureTime: '2026-10-05T20:30:00Z',
      originAddress: 'ITNL',
      destinationAddress: 'Centro',
      passengers: 3,
      amount: 90.5,
    },
    {
      rideId: 'r2',
      departureTime: '2026-10-04T14:00:00Z',
      originAddress: null,
      destinationAddress: null,
      passengers: 1,
      amount: 30,
    },
  ],
  total: 25,
  page: 1,
  pageSize: 10,
};
const state = (
  value: DriverPage<DriverRide> | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data: value, loading: false, error: null, reload, ...extra });
const path = (days: number, pageNumber = 1) => {
  const r = rangeFromDays(days);
  return `/drivers/me/rides?status=completed&from=${r.from}&to=${r.to}&page=${pageNumber}&pageSize=10`;
};

describe('historial de viajes del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
  });

  it('pide solo los viajes realizados del último mes', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    expect(resource).toHaveBeenCalledWith(path(30));
  });

  it('lista fecha, ruta, pasajeros e importe, y tolera direcciones ausentes', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    const row = screen.getByRole('row', { name: /ITNL/ });
    expect(row).toHaveTextContent('ITNL → Centro');
    expect(within(row).getByText(money(90.5))).toBeVisible();
    expect(
      screen.getByRole('row', { name: /Origen sin registrar/ }),
    ).toHaveTextContent('Destino sin registrar');
    expect(screen.getByText('25 viajes realizados')).toBeVisible();
  });

  it('pagina y vuelve a la página 1 al cambiar de periodo', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByText('Página 1 de 3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(resource).toHaveBeenLastCalledWith(path(30, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    expect(resource).toHaveBeenLastCalledWith(path(7, 1));
  });

  it('muestra el estado vacío', () => {
    resource.mockReturnValue(state({ ...page, items: [], total: 0 }));
    render(<DriverTripHistory />);
    expect(
      screen.getByText('No hay viajes realizados en este periodo.'),
    ).toBeVisible();
    expect(screen.getByText('Página 1 de 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('muestra el error y permite reintentar', () => {
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<DriverTripHistory />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
