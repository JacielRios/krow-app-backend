const TIMEZONE = 'America/Monterrey';

export type PeriodKey = 'week' | 'month' | 'quarter';
export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: 'week', label: 'Semana', days: 7 },
  { key: 'month', label: '1 mes', days: 30 },
  { key: 'quarter', label: '3 meses', days: 90 },
];

export type DateRange = { from: string; to: string };

/** Rango terminado hoy (hora de Monterrey) que incluye `days` días. */
export function rangeFromDays(days: number, now = new Date()): DateRange {
  const to = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [year, month, day] = to.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { from: start.toISOString().slice(0, 10), to };
}

export function periodRange(key: PeriodKey): DateRange {
  const period = PERIODS.find((item) => item.key === key) ?? PERIODS[1];
  return rangeFromDays(period.days);
}

/** Contrato de GET /v1/drivers/me/dashboard-summary (importes en pesos). */
export interface DriverDashboardData {
  completed: number;
  cancelled: number;
  ongoing: number;
  scheduled: number;
  totalTrips: number;
  passengers: number;
  occupancy: number;
  revenue: number;
  paid: number | null;
  pending: number | null;
  timezone: string;
  currency: string;
  trend: {
    date: string;
    completed: number;
    cancelled: number;
    revenue: number;
  }[];
  topRoutes: {
    route: string;
    trips: number;
    occupancy: number;
    revenue: number;
  }[];
}

/** Contrato de GET /v1/drivers/me/rides (importes en pesos). */
export interface DriverRide {
  rideId: string;
  departureTime: string;
  originAddress: string | null;
  destinationAddress: string | null;
  passengers: number;
  amount: number;
}

export const money = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    value,
  );
export const number = (value: number) =>
  new Intl.NumberFormat('es-MX').format(value);
export const percent = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : 0;

export function driverInsights(data: DriverDashboardData): string[] {
  if (data.totalTrips === 0)
    return ['No tienes viajes con salida en este periodo.'];
  const lines = [
    `${number(data.completed)} viajes realizados y ${number(data.cancelled)} cancelados de ${number(data.totalTrips)} viajes del periodo.`,
  ];
  const top = data.topRoutes[0];
  if (top)
    lines.push(
      `${top.route}: ${number(top.trips)} ${top.trips === 1 ? 'viaje' : 'viajes'}, tu ruta con mayor actividad.`,
    );
  if (data.pending !== null && data.pending > 0)
    lines.push(
      `${money(data.pending)} de efectivo pendiente de registrar como recibido.`,
    );
  return lines;
}
