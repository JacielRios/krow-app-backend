export type Range = { from: string; to: string };
export interface DayPoint {
  date: string;
  completed: number;
  cancelled: number;
  revenue: number;
}
export interface RouteRow {
  route: string;
  trips: number;
  occupancy: number;
  revenue: number;
}
export interface DashboardData {
  completed: number;
  cancelled: number;
  ongoing: number;
  scheduled: number;
  totalTrips: number;
  activeDrivers: number;
  inactiveDrivers: number;
  passengers: number;
  reservedPassengers: number;
  occupancy: number;
  revenue: number;
  paid: number | null;
  pending: number | null;
  timezone: string;
  currency: string;
  trend: DayPoint[];
  topRoutes: RouteRow[];
}

export const money = (value: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(value);
export const number = (value: number) => value.toLocaleString('es-MX');
export const percent = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : 0;

export function dashboardInsights(data: DashboardData): string[] {
  if (data.totalTrips === 0)
    return [
      'No hay viajes en este periodo. Amplía las fechas para consultar la actividad.',
    ];
  const insights = [
    `${data.completed} viajes realizados y ${data.cancelled} cancelados de ${data.totalTrips} viajes del periodo.`,
  ];
  const top = data.topRoutes[0];
  if (top)
    insights.push(
      `${top.route}: ${number(top.trips)} viajes, la ruta con mayor actividad.`,
    );
  if (data.pending !== null)
    insights.push(
      `${money(data.pending)} de efectivo pendiente de registrar como recibido.`,
    );
  return insights;
}
