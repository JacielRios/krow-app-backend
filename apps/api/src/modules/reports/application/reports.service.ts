import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { PilotDatabase } from '../../pilot/pilot.database.js';
import { adminTransaction } from '../../admin/admin.database.js';
import type { DashboardSummaryQueryDto } from '../presentation/reports.dto.js';

export interface DashboardSummary {
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

// Aggregate in PostgreSQL: REST row limits and per-user RLS must not truncate
// administrative totals. Booking prices are committed totals in integer cents.
export const DASHBOARD_SUMMARY_SQL = `
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
  where r.departure_time >= bounds.starts_at and r.departure_time < bounds.ends_at
), drivers as (
  select count(*) filter(where d.status='approved'
    and coalesce(to_jsonb(d)->>'admin_status','active')='active'
    and u.is_active is distinct from false and u.deleted_at is null) as active,
    count(*) as total
  from public.driver_profiles d join public.users u on u.uuid=d.user_id
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
  'activeDrivers',d.active,'inactiveDrivers',d.total-d.active,
  'passengers',t.passengers,'reservedPassengers',t.reserved,
  'occupancy',case when t.offered>0 then round(t.reserved*100.0/t.offered,1) else 0 end,
  'revenue',t.amount/100.0,'paid',t.paid/100.0,'pending',t.pending/100.0,
  'currency','MXN','timezone','America/Monterrey',
  'trend',coalesce((select jsonb_agg(jsonb_build_object('date',day::text,
    'completed',completed,'cancelled',cancelled,'revenue',amount/100.0) order by day) from daily),'[]'::jsonb),
  'topRoutes',coalesce((select jsonb_agg(jsonb_build_object('route',route,'trips',trips,
    'occupancy',case when offered>0 then round(reserved*100.0/offered,1) else 0 end,
    'revenue',amount/100.0) order by trips desc,route) from routes),'[]'::jsonb)
) as summary from totals t cross join drivers d
`;

@Injectable()
export class ReportsService {
  constructor(private readonly database: PilotDatabase) {}

  async dashboardSummary(
    user: AuthenticatedUser,
    query: DashboardSummaryQueryDto,
  ) {
    if (user.appMetadata.role !== 'admin')
      throw new ForbiddenException('Acceso administrativo requerido');
    const from = this.calendarDate(query.from);
    const to = this.calendarDate(query.to);
    const days = (to - from) / 86_400_000;
    if (days < 0 || days > 365)
      throw new BadRequestException(
        'Selecciona un rango válido de hasta 366 días.',
      );
    return adminTransaction(this.database, user, async (client) => {
      const result = await client.query<{ summary: DashboardSummary }>(
        DASHBOARD_SUMMARY_SQL,
        [query.from, query.to],
      );
      return result.rows[0].summary;
    });
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
