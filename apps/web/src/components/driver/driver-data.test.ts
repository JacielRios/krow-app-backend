import { describe, it, expect } from 'vitest';
import {
  driverInsights,
  money,
  percent,
  rangeFromDays,
  type DriverDashboardData,
} from './driver-data';

const base: DriverDashboardData = {
  completed: 5,
  cancelled: 1,
  ongoing: 0,
  scheduled: 2,
  totalTrips: 8,
  passengers: 7,
  occupancy: 55,
  revenue: 134.75,
  paid: 45.25,
  pending: 89.5,
  timezone: 'America/Monterrey',
  currency: 'MXN',
  trend: [],
  topRoutes: [{ route: 'ITNL → Centro', trips: 5, occupancy: 55, revenue: 134.75 }],
};

describe('periodos y formatos del conductor', () => {
  it('usa la fecha de Monterrey aunque en UTC ya sea el siguiente día', () => {
    expect(rangeFromDays(7, new Date('2026-10-08T01:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    });
  });
  it('calcula 30 y 90 días cruzando meses y años', () => {
    expect(rangeFromDays(30, new Date('2026-10-25T18:00:00Z'))).toEqual({
      from: '2026-09-26',
      to: '2026-10-25',
    });
    expect(rangeFromDays(90, new Date('2026-02-10T18:00:00Z'))).toEqual({
      from: '2025-11-13',
      to: '2026-02-10',
    });
  });
  it('no divide entre cero y conserva centavos', () => {
    expect(percent(3, 0)).toBe(0);
    expect(money(10.25)).toContain('10.25');
  });
});

describe('lectura rápida', () => {
  it('resume viajes, ruta principal y efectivo pendiente', () => {
    const text = driverInsights(base).join(' ');
    expect(text).toContain('5 viajes realizados y 1 cancelados de 8');
    expect(text).toContain('ITNL → Centro');
    expect(text).toContain('efectivo pendiente');
  });
  it('no inventa cobros ni rutas cuando no hay datos', () => {
    expect(
      driverInsights({ ...base, pending: null, topRoutes: [] }).join(' '),
    ).not.toMatch(/efectivo pendiente|ruta con mayor/);
    expect(driverInsights({ ...base, totalTrips: 0 })).toEqual([
      'No tienes viajes con salida en este periodo.',
    ]);
  });
});
