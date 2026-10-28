import type { ReactNode } from 'react';
import { formatDate } from '@/lib/admin-utils';

const TIMEZONE = 'America/Monterrey';
const DAY_MS = 86_400_000;

export type PeriodKey = 'week' | 'month' | 'quarter';
export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: 'week', label: 'Semana', days: 7 },
  { key: 'month', label: '1 mes', days: 30 },
  { key: 'quarter', label: '3 meses', days: 90 },
];

export type DateRange = { from: string; to: string };

/** Fecha de hoy (AAAA-MM-DD) en la hora de Monterrey. */
export function monterreyToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** Rango terminado hoy (hora de Monterrey) que incluye `days` días. */
export function rangeFromDays(days: number, now = new Date()): DateRange {
  const to = monterreyToday(now);
  return { from: shiftDate(to, -(days - 1)), to };
}

export function periodRange(key: PeriodKey): DateRange {
  const period = PERIODS.find((item) => item.key === key) ?? PERIODS[1];
  return rangeFromDays(period.days);
}

/* ---------- Semanas (lunes a domingo) ---------- */

export function mondayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}
export const currentWeekStart = (now = new Date()) =>
  mondayOf(monterreyToday(now));
export const shiftWeek = (weekStart: string, weeks: number) =>
  shiftDate(weekStart, weeks * 7);
export const weekEnd = (weekStart: string) => shiftDate(weekStart, 6);

/* ---------- Contratos de la API ---------- */

/** GET /v1/drivers/me/dashboard-summary (importes en pesos). */
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

/** GET /v1/drivers/me/rides (importes en pesos). */
export interface DriverRide {
  rideId: string;
  departureTime: string;
  originAddress: string | null;
  destinationAddress: string | null;
  passengers: number;
  amount: number;
}

/** GET /v1/drivers/me/profile (sin identificadores). */
export interface DriverProfile {
  fullName: string | null;
  email: string | null;
  photoUrl: string | null;
  academicProgram: string | null;
  academicPeriod: number | null;
  licenseNumber: string;
  licenseExpiry: string;
  rating: number | null;
  status: string;
  memberSince: string;
}

export type PaymentMethod = 'cash' | 'card';

/**
 * GET /v1/drivers/me/weekly-report (importes en pesos).
 * `net` es lo que recibe el conductor ($ por pasajero transportado);
 * `retained` es lo que retiene KROW de lo cobrado a los pasajeros.
 */
export interface DriverWeeklyReport {
  driverName: string | null;
  weekStart: string;
  weekEnd: string;
  currency: string;
  timezone: string;
  payPerPassenger: number;
  totals: {
    trips: number;
    passengers: number;
    gross: number;
    retained: number;
    net: number;
  };
  byMethod: {
    method: PaymentMethod;
    payments: number;
    passengers: number;
    gross: number;
    retained: number;
    net: number;
  }[];
  trips: {
    rideId: string;
    departureTime: string;
    originAddress: string | null;
    destinationAddress: string | null;
    passengers: number;
    gross: number;
    retained: number;
    net: number;
  }[];
}

/* ---------- Formatos ---------- */

export const money = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    value,
  );
export const number = (value: number) =>
  new Intl.NumberFormat('es-MX').format(value);
export const percent = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : 0;
export const methodLabel = (method: PaymentMethod) =>
  method === 'card' ? 'Tarjeta' : 'Efectivo';

/** Solo se muestran fotos con URL http(s); cualquier otro valor usa iniciales. */
export function safePhotoUrl(value: string | null | undefined) {
  return value && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

export function initials(name: string | null | undefined) {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return letters || 'K';
}

/** Estado de la licencia según su fecha de vencimiento (hora de Monterrey). */
export function licenseStatus(expiry: string, now = new Date()) {
  const [year, month, day] = expiry.split('-').map(Number);
  const [ty, tm, td] = monterreyToday(now).split('-').map(Number);
  const days = Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(ty, tm - 1, td)) / DAY_MS,
  );
  const tone: 'expired' | 'soon' | 'ok' =
    days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok';
  return { tone, days };
}

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

/* ---------- Componentes compartidos ---------- */

export function MetricCard({
  tone,
  label,
  value,
  hint,
  progress,
}: {
  tone: 'trips' | 'alert' | 'riders' | 'money';
  label: string;
  value: string;
  hint?: ReactNode;
  progress?: number;
}) {
  return (
    <article className={`drv-card drv-tone-${tone}`}>
      <p className="drv-card-label">{label}</p>
      <p className="drv-card-value">{value}</p>
      {progress !== undefined && (
        <div className="drv-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {hint && <p className="drv-card-hint">{hint}</p>}
    </article>
  );
}

export function RangeTabs({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
}) {
  return (
    <div className="drv-range" role="group" aria-label="Periodo">
      {PERIODS.map((period) => (
        <button
          key={period.key}
          type="button"
          aria-pressed={value === period.key}
          onClick={() => onChange(period.key)}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

export function TripsBars({ data }: { data: DriverDashboardData['trend'] }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.completed + d.cancelled));
  const completed = data.reduce((sum, d) => sum + d.completed, 0);
  const cancelled = data.reduce((sum, d) => sum + d.cancelled, 0);
  return (
    <div>
      <div
        className="drv-bars"
        role="img"
        aria-label={`Viajes por día: ${completed} realizados y ${cancelled} cancelados`}
      >
        {data.map((day) => (
          <div
            key={day.date}
            className="drv-bar"
            title={`${formatDate(day.date)}: ${day.completed} realizados, ${day.cancelled} cancelados`}
          >
            <span
              className="cancelled"
              style={{ height: `${(day.cancelled / max) * 100}%` }}
            />
            <span
              className="done"
              style={{ height: `${(day.completed / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="drv-bars-axis">
        <span>{formatDate(data[0].date)}</span>
        <span>{formatDate(data[data.length - 1].date)}</span>
      </div>
      <p className="drv-legend">
        <span className="dot done" /> Realizados{' '}
        <span className="dot cancelled" /> Cancelados
      </p>
    </div>
  );
}
