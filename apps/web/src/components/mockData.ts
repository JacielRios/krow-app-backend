// Datos de ejemplo. Reemplaza getMockData por las consultas de packages/api-client
// (idealmente vistas SQL / RPC en Supabase que ya devuelvan estos agregados).
export type Range = { from: string; to: string }; // YYYY-MM-DD

export interface DayPoint { date: string; completed: number; cancelled: number; revenue: number }
export interface RouteRow { route: string; trips: number; occupancy: number; revenue: number }
export interface DashboardData {
  completed: number; cancelled: number; ongoing: number;
  activeDrivers: number; inactiveDrivers: number;
  passengers: number; occupancy: number;
  revenue: number; paid: number; pending: number;
  trend: DayPoint[]; topRoutes: RouteRow[];
}

const rng = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
};

const ROUTES = [
  "Santiago → Tec de Monterrey", "San Nicolás → Valle Oriente", "Apodaca → Centro Monterrey",
  "Guadalupe → San Pedro", "Escobedo → Parque Fundidora",
];

export function getMockData({ from, to }: Range): DashboardData {
  const start = new Date(from), end = new Date(to);
  const days = Math.max(1, Math.round((+end - +start) / 864e5) + 1);
  const trend: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10), r = rng(date);
    const completed = Math.round(80 + r() * 60), cancelled = Math.round(6 + r() * 14);
    trend.push({ date, completed, cancelled, revenue: completed * (38 + Math.round(r() * 10)) });
  }
  const sum = (k: keyof DayPoint) => trend.reduce((a, p) => a + (p[k] as number), 0);
  const completed = sum("completed"), revenue = sum("revenue");
  const passengers = Math.round(completed * 2.3), r = rng(to);
  const topRoutes = ROUTES.map((route, i) => {
    const trips = Math.round((completed * (0.28 - i * 0.045)) * (0.9 + r() * 0.2));
    return { route, trips, occupancy: Math.round(48 + r() * 40), revenue: trips * 44 };
  }).sort((a, b) => b.trips - a.trips);
  return {
    completed, cancelled: sum("cancelled"), ongoing: Math.round(9 + r() * 12),
    activeDrivers: 142, inactiveDrivers: 38,
    passengers, occupancy: Math.round((passengers / (completed * 4)) * 100),
    revenue, paid: Math.round(revenue * 0.92), pending: Math.round(revenue * 0.08),
    trend, topRoutes,
  };
}
