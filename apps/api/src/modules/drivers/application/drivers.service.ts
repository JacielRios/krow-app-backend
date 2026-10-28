import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { PilotDatabase } from '../../pilot/pilot.database.js';
import type { DashboardSummaryQueryDto } from '../../reports/presentation/reports.dto.js';
import type {
  DriverRidesQueryDto,
  DriverWeeklyReportQueryDto,
} from '../presentation/drivers.controller.js';

export interface DriverDashboardSummary {
  completed: number;
  cancelled: number;
  ongoing: number;
  scheduled: number;
  totalTrips: number;
  passengers: number;
  reservedPassengers: number;
  occupancy: number;
  revenue: number;
  paid: number;
  pending: number;
  currency: 'MXN';
  timezone: 'America/Monterrey';
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

export interface DriverRideItem {
  rideId: string;
  departureTime: string;
  originAddress: string | null;
  destinationAddress: string | null;
  passengers: number;
  amount: number;
}

export interface DriverRidesPage {
  items: DriverRideItem[];
  total: number;
  page: number;
  pageSize: number;
}

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

export interface DriverWeeklyReport {
  driverName: string | null;
  weekStart: string;
  weekEnd: string;
  currency: 'MXN';
  timezone: 'America/Monterrey';
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

// "Pago del alumno" (CVM) de la tabla de costos: lo que recibe el conductor por
// cada pasajero transportado, sin importar la forma de pago ni el precio del
// viaje. Lo demás de lo cobrado (gastos y margen) lo retiene KROW.
export const DRIVER_PAY_PER_PASSENGER_CENTS = 2000;

// Un conductor habilitado es el que el panel de administración cuenta como
// activo: perfil aprobado, admin_status activo y cuenta sin cerrar.
export const DRIVER_LOOKUP_SQL = `
select d.driver_id
from public.driver_profiles d
join public.users u on u.uuid = d.user_id
where d.user_id = $1
  and d.status = 'approved'
  and coalesce(to_jsonb(d)->>'admin_status','active') = 'active'
  and u.is_active is distinct from false and u.deleted_at is null
limit 1
`;

// Misma lógica que DASHBOARD_SUMMARY_SQL de reportes, limitada a los viajes
// del conductor ($3) y sin los conteos de otros conductores.
export const DRIVER_DASHBOARD_SQL = `
with bounds as (
  select $1::date as first_day, $2::date as last_day,
    $1::date::timestamp at time zone 'America/Monterrey' as starts_at,
    ($2::date + 1)::timestamp at time zone 'America/Monterrey' as ends_at
), ride_metrics as (
  select r.ride_id, r.status,
    (r.departure_time at time zone 'America/Monterrey')::date as day,
    coalesce(nullif(r.origin_address,''),'Origen sin dirección') || ' → ' ||
      coalesce(nullif(r.destination_address,''),'Destino sin dirección') as route,
    coalesce(b.reserved,0) as reserved, coalesce(b.transported,0) as transported,
    greatest(r.available_seats,0) + coalesce(b.reserved,0) as offered,
    coalesce(b.amount,0) as amount, coalesce(b.paid,0) as paid,
    coalesce(b.pending,0) as pending
  from public.rides r cross join bounds
  left join lateral (
    select sum(b.seats_reserved) as reserved,
      sum(b.seats_reserved) filter(where b.status in ('in_progress','completed')) as transported,
      sum(coalesce(p.amount_cents,round(r.price_per_seat*100)::bigint*b.seats_reserved)) as amount,
      sum(c.amount_cents) filter(where c.status='collected') as paid,
      sum(coalesce(p.amount_cents,round(r.price_per_seat*100)::bigint*b.seats_reserved))
        filter(where coalesce(c.status,'pending')='pending') as pending
    from public.bookings b
    left join krow_pilot.booking_prices p on p.booking_id=b.booking_id
    left join krow_pilot.cash c on c.booking_id=b.booking_id
    where b.ride_id=r.ride_id and b.status in ('confirmed','in_progress','completed')
  ) b on r.status <> 'cancelled'
  where r.driver_id = $3::uuid
    and r.departure_time >= bounds.starts_at and r.departure_time < bounds.ends_at
), totals as (
  select count(*) as trips,
    count(*) filter(where status='completed') as completed,
    count(*) filter(where status='cancelled') as cancelled,
    count(*) filter(where status='in_progress') as ongoing,
    count(*) filter(where status in ('scheduled','full')) as scheduled,
    coalesce(sum(transported),0) as passengers,
    coalesce(sum(reserved),0) as reserved,
    coalesce(sum(offered) filter(where status <> 'cancelled'),0) as offered,
    coalesce(sum(amount),0) as amount, coalesce(sum(paid),0) as paid,
    coalesce(sum(pending),0) as pending
  from ride_metrics
), daily as (
  select days.day::date as day,
    count(r.ride_id) filter(where r.status='completed') as completed,
    count(r.ride_id) filter(where r.status='cancelled') as cancelled,
    coalesce(sum(r.amount),0) as amount
  from bounds cross join lateral generate_series(bounds.first_day::timestamp,
    bounds.last_day::timestamp,interval '1 day') days(day)
  left join ride_metrics r on r.day=days.day::date
  group by days.day
), routes as (
  select route,count(*) as trips, sum(reserved) as reserved,
    sum(offered) as offered, sum(amount) as amount
  from ride_metrics where status <> 'cancelled'
  group by route order by count(*) desc,route limit 5
)
select jsonb_build_object(
  'completed',t.completed,'cancelled',t.cancelled,'ongoing',t.ongoing,
  'scheduled',t.scheduled,'totalTrips',t.trips,
  'passengers',t.passengers,'reservedPassengers',t.reserved,
  'occupancy',case when t.offered>0 then round(t.reserved*100.0/t.offered,1) else 0 end,
  'revenue',t.amount/100.0,'paid',t.paid/100.0,'pending',t.pending/100.0,
  'currency','MXN','timezone','America/Monterrey',
  'trend',coalesce((select jsonb_agg(jsonb_build_object('date',day::text,
    'completed',completed,'cancelled',cancelled,'revenue',amount/100.0) order by day) from daily),'[]'::jsonb),
  'topRoutes',coalesce((select jsonb_agg(jsonb_build_object('route',route,'trips',trips,
    'occupancy',case when offered>0 then round(reserved*100.0/offered,1) else 0 end,
    'revenue',amount/100.0) order by trips desc,route) from routes),'[]'::jsonb)
) as summary from totals t
`;

// Historial paginado: primero se filtra y pagina, y solo después se calculan
// pasajeros e importe de las filas de la página.
export const DRIVER_RIDES_SQL = `
with bounds as (
  select $1::date::timestamp at time zone 'America/Monterrey' as starts_at,
    ($2::date + 1)::timestamp at time zone 'America/Monterrey' as ends_at
), filtered as (
  select r.* from public.rides r cross join bounds
  where r.driver_id = $3::uuid
    and r.departure_time >= bounds.starts_at and r.departure_time < bounds.ends_at
    and ($4::text is null or r.status = $4::text)
), paged as (
  select * from filtered order by departure_time desc, ride_id limit $5 offset $6
), page_rows as (
  select p.ride_id, p.departure_time, p.origin_address, p.destination_address,
    coalesce(b.transported,0) as transported, coalesce(b.amount,0) as amount
  from paged p
  left join lateral (
    select sum(b.seats_reserved) filter(where b.status in ('in_progress','completed')) as transported,
      sum(coalesce(x.amount_cents,round(p.price_per_seat*100)::bigint*b.seats_reserved)) as amount
    from public.bookings b
    left join krow_pilot.booking_prices x on x.booking_id=b.booking_id
    where b.ride_id=p.ride_id and b.status in ('confirmed','in_progress','completed')
  ) b on p.status <> 'cancelled'
)
select (select count(*) from filtered)::int as total,
  coalesce(jsonb_agg(jsonb_build_object(
    'rideId',ride_id,'departureTime',departure_time,
    'originAddress',origin_address,'destinationAddress',destination_address,
    'passengers',transported,'amount',amount/100.0
  ) order by departure_time desc, ride_id),'[]'::jsonb) as items
from page_rows
`;

// Datos propios del conductor (users + driver_profiles) sin ningún id.
export const DRIVER_PROFILE_SQL = `
select jsonb_build_object(
  'fullName', u.full_name, 'email', u.email_address,
  'photoUrl', u.profile_photo,
  'academicProgram', u.academic_program, 'academicPeriod', u.academic_period,
  'licenseNumber', d.license_number, 'licenseExpiry', d.license_expiry::text,
  'rating', d.rating, 'status', d.status, 'memberSince', d.created_at
) as profile
from public.driver_profiles d
join public.users u on u.uuid = d.user_id
where d.driver_id = $1::uuid
`;

// Reporte semanal (lunes a domingo, hora de Monterrey) de viajes completados.
// Cada pasajero transportado (asiento de una reserva completada) le paga al
// conductor $3 (centavos), sea en efectivo o con tarjeta; lo cobrado menos eso
// es lo que retiene KROW. Se excluyen reservas con cobro en efectivo anulado.
// El método de pago sale de bookings.payment_method; si la columna no existe,
// todo se cuenta como efectivo (solo afecta el desglose, no la ganancia).
export const DRIVER_WEEKLY_REPORT_SQL = `
with bounds as (
  select $1::date as first_day,
    $1::date::timestamp at time zone 'America/Monterrey' as starts_at,
    ($1::date + 7)::timestamp at time zone 'America/Monterrey' as ends_at
), week_rides as (
  select r.ride_id, r.departure_time, r.origin_address, r.destination_address,
    r.price_per_seat
  from public.rides r cross join bounds
  where r.driver_id = $2::uuid and r.status = 'completed'
    and r.departure_time >= bounds.starts_at and r.departure_time < bounds.ends_at
), payments as (
  select w.ride_id, b.seats_reserved,
    case when lower(coalesce(to_jsonb(b)->>'payment_method','cash')) = 'card'
      then 'card' else 'cash' end as method,
    coalesce(p.amount_cents, round(w.price_per_seat*100)::bigint*b.seats_reserved) as gross_cents
  from week_rides w
  join public.bookings b on b.ride_id = w.ride_id and b.status = 'completed'
  left join krow_pilot.booking_prices p on p.booking_id = b.booking_id
  left join krow_pilot.cash c on c.booking_id = b.booking_id
  where coalesce(c.status,'pending') not in ('voided','void')
), priced as (
  select ps.*, ps.seats_reserved * $3::int as net_cents
  from payments ps
), per_trip as (
  select w.ride_id, w.departure_time, w.origin_address, w.destination_address,
    coalesce(sum(p.seats_reserved),0) as passengers,
    coalesce(sum(p.gross_cents),0) as gross,
    coalesce(sum(p.net_cents),0) as net
  from week_rides w left join priced p on p.ride_id = w.ride_id
  group by w.ride_id, w.departure_time, w.origin_address, w.destination_address
), by_method as (
  select m.method, count(p.method) as payments,
    coalesce(sum(p.seats_reserved),0) as passengers,
    coalesce(sum(p.gross_cents),0) as gross,
    coalesce(sum(p.net_cents),0) as net
  from (values ('cash'),('card')) m(method)
  left join priced p on p.method = m.method
  group by m.method
), totals as (
  select count(*) as trips, coalesce(sum(passengers),0) as passengers,
    coalesce(sum(gross),0) as gross, coalesce(sum(net),0) as net
  from per_trip
)
select jsonb_build_object(
  'driverName', (select u.full_name from public.driver_profiles d
    join public.users u on u.uuid = d.user_id where d.driver_id = $2::uuid),
  'weekStart', (select first_day::text from bounds),
  'weekEnd', (select (first_day + 6)::text from bounds),
  'currency', 'MXN', 'timezone', 'America/Monterrey',
  'payPerPassenger', $3::int/100.0,
  'totals', jsonb_build_object('trips', t.trips, 'passengers', t.passengers,
    'gross', t.gross/100.0, 'retained', (t.gross - t.net)/100.0, 'net', t.net/100.0),
  'byMethod', coalesce((select jsonb_agg(jsonb_build_object(
      'method', method, 'payments', payments, 'passengers', passengers,
      'gross', gross/100.0, 'retained', (gross - net)/100.0, 'net', net/100.0)
    order by case method when 'cash' then 0 else 1 end) from by_method), '[]'::jsonb),
  'trips', coalesce((select jsonb_agg(jsonb_build_object(
      'rideId', ride_id, 'departureTime', departure_time,
      'originAddress', origin_address, 'destinationAddress', destination_address,
      'passengers', passengers, 'gross', gross/100.0,
      'retained', (gross - net)/100.0, 'net', net/100.0)
    order by departure_time, ride_id) from per_trip), '[]'::jsonb)
) as report from totals t
`;

@Injectable()
export class DriversService {
  constructor(private readonly database: PilotDatabase) {}

  /** Confirma que la cuenta autenticada es un conductor habilitado. */
  me(user: AuthenticatedUser) {
    return this.withDriver(user, async (_client, driverId) => ({
      driver_id: driverId,
    }));
  }

  /** Datos del perfil del conductor, sin identificadores. */
  profile(user: AuthenticatedUser) {
    return this.withDriver(user, async (client, driverId) => {
      const result = await client.query<{ profile: DriverProfile }>(
        DRIVER_PROFILE_SQL,
        [driverId],
      );
      return result.rows[0].profile;
    });
  }

  async weeklyReport(
    user: AuthenticatedUser,
    query: DriverWeeklyReportQueryDto,
  ) {
    const start = this.calendarDate(query.weekStart);
    if (new Date(start).getUTCDay() !== 1)
      throw new BadRequestException('La semana debe iniciar en lunes.');
    return this.withDriver(user, async (client, driverId) => {
      const result = await client.query<{ report: DriverWeeklyReport }>(
        DRIVER_WEEKLY_REPORT_SQL,
        [query.weekStart, driverId, DRIVER_PAY_PER_PASSENGER_CENTS],
      );
      return result.rows[0].report;
    });
  }

  async dashboardSummary(
    user: AuthenticatedUser,
    query: DashboardSummaryQueryDto,
  ) {
    this.validateRange(query.from, query.to);
    return this.withDriver(user, async (client, driverId) => {
      const result = await client.query<{ summary: DriverDashboardSummary }>(
        DRIVER_DASHBOARD_SQL,
        [query.from, query.to, driverId],
      );
      return result.rows[0].summary;
    });
  }

  async rides(
    user: AuthenticatedUser,
    query: DriverRidesQueryDto,
  ): Promise<DriverRidesPage> {
    this.validateRange(query.from, query.to);
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 10);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50
    )
      throw new BadRequestException('La paginación no es válida.');
    return this.withDriver(user, async (client, driverId) => {
      const result = await client.query<{
        total: number;
        items: DriverRideItem[];
      }>(DRIVER_RIDES_SQL, [
        query.from,
        query.to,
        driverId,
        query.status ?? null,
        pageSize,
        (page - 1) * pageSize,
      ]);
      const row = result.rows[0];
      return { items: row.items, total: row.total, page, pageSize };
    });
  }

  // El conductor se resuelve aquí, dentro de la misma transacción, a partir
  // del usuario verificado por SupabaseAuthGuard. Ningún id llega del cliente.
  private withDriver<T>(
    user: AuthenticatedUser,
    work: (client: PoolClient, driverId: string) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (client) => {
      const found = await client.query<{ driver_id: string }>(
        DRIVER_LOOKUP_SQL,
        [user.id],
      );
      const driverId = found.rows[0]?.driver_id;
      if (!driverId)
        throw new ForbiddenException('Acceso de conductor requerido');
      return work(client, driverId);
    });
  }

  private validateRange(fromValue: string, toValue: string) {
    const from = this.calendarDate(fromValue);
    const to = this.calendarDate(toValue);
    const days = (to - from) / 86_400_000;
    if (days < 0 || days > 365)
      throw new BadRequestException(
        'Selecciona un rango válido de hasta 366 días.',
      );
  }

  private calendarDate(value: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Usa fechas con formato AAAA-MM-DD.');
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException('La fecha no es válida.');
    return timestamp;
  }
}
