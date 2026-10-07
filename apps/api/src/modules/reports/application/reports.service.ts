import { BadRequestException, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { Database } from '../../../infrastructure/supabase/database.types.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type { DashboardSummaryQueryDto } from '../presentation/reports.dto.js';

type ReportsClient = SupabaseClient<Database>;
type RideRow = Database['public']['Tables']['rides']['Row'];
type BookingStatusRow = Pick<
  Database['public']['Tables']['bookings']['Row'],
  'status' | 'seats_reserved'
>;
type RideWithBookings = Pick<
  RideRow,
  | 'ride_id'
  | 'status'
  | 'departure_time'
  | 'price_per_seat'
  | 'available_seats'
  | 'origin_address'
  | 'destination_address'
> & { bookings: BookingStatusRow[] };

// Estados de booking que cuentan como "pasajero sí viajó / va a viajar".
const CONFIRMED_BOOKING_STATUSES = ['confirmed', 'completed', 'in_progress'];

@Injectable()
export class ReportsService {
  constructor(private readonly supabase: SupabaseService) {}

  async dashboardSummary(
    user: AuthenticatedUser,
    query: DashboardSummaryQueryDto,
  ) {
    const client = this.client(user);
    const fromIso = `${query.from}T00:00:00.000Z`;
    const toIso = `${query.to}T23:59:59.999Z`;

    // 1. Trae todos los viajes del rango, con sus reservas (bookings) incluidas.
    const { data, error } = await client
      .from('rides')
      .select(
        `ride_id, status, departure_time, price_per_seat, available_seats,
         origin_address, destination_address,
         bookings(status, seats_reserved)`,
      )
      .gte('departure_time', fromIso)
      .lte('departure_time', toIso);
    if (error) throw new BadRequestException(error.message);
    const rides = (data ?? []) as unknown as RideWithBookings[];

    // 2. Cuenta conductores activos e inactivos (no depende del rango de fechas).
    const { count: activeDrivers, error: activeErr } = await client
      .from('driver_profiles')
      .select('driver_id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (activeErr) throw new BadRequestException(activeErr.message);

    const { count: inactiveDrivers, error: inactiveErr } = await client
      .from('driver_profiles')
      .select('driver_id', { count: 'exact', head: true })
      .neq('status', 'active');
    if (inactiveErr) throw new BadRequestException(inactiveErr.message);

    return this.aggregate(rides, activeDrivers ?? 0, inactiveDrivers ?? 0);
  }

  // Toda la suma/conteo pasa aquí, en JavaScript, a partir de los datos crudos.
  private aggregate(
    rides: RideWithBookings[],
    activeDrivers: number,
    inactiveDrivers: number,
  ) {
    let completed = 0;
    let cancelled = 0;
    let ongoing = 0;
    let passengers = 0;
    let revenue = 0;
    const byDay = new Map<
      string,
      { completed: number; cancelled: number; revenue: number }
    >();
    const byRoute = new Map<
      string,
      { trips: number; revenue: number; seatsReserved: number; seatsOffered: number }
    >();

    for (const ride of rides) {
      const day = ride.departure_time.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { completed: 0, cancelled: 0, revenue: 0 });
      const dayBucket = byDay.get(day)!;

      if (ride.status === 'completed') {
        completed++;
        dayBucket.completed++;
      }
      if (ride.status === 'cancelled') {
        cancelled++;
        dayBucket.cancelled++;
      }
      if (ride.status === 'in_progress') ongoing++;

      const confirmedBookings = (ride.bookings ?? []).filter((b) =>
        CONFIRMED_BOOKING_STATUSES.includes(b.status),
      );
      const seatsReserved = confirmedBookings.reduce(
        (sum, b) => sum + b.seats_reserved,
        0,
      );
      const rideRevenue = seatsReserved * Number(ride.price_per_seat);
      passengers += seatsReserved;
      revenue += rideRevenue;
      dayBucket.revenue += rideRevenue;

      const routeKey = `${ride.origin_address ?? 'Origen sin dirección'} → ${
        ride.destination_address ?? 'Destino sin dirección'
      }`;
      if (!byRoute.has(routeKey))
        byRoute.set(routeKey, { trips: 0, revenue: 0, seatsReserved: 0, seatsOffered: 0 });
      const routeBucket = byRoute.get(routeKey)!;
      routeBucket.trips++;
      routeBucket.revenue += rideRevenue;
      routeBucket.seatsReserved += seatsReserved;
      routeBucket.seatsOffered += ride.available_seats;
    }

    const trend = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v, revenue: Math.round(v.revenue) }));

    const topRoutes = [...byRoute.entries()]
      .map(([route, v]) => ({
        route,
        trips: v.trips,
        revenue: Math.round(v.revenue),
        occupancy:
          v.seatsOffered > 0 ? Math.round((v.seatsReserved / v.seatsOffered) * 100) : 0,
      }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 5);

    const totalOfferedSeats = rides.reduce((s, r) => s + r.available_seats, 0);

    return {
      completed,
      cancelled,
      ongoing,
      activeDrivers,
      inactiveDrivers,
      passengers,
      occupancy:
        totalOfferedSeats > 0 ? Math.round((passengers / totalOfferedSeats) * 100) : 0,
      revenue: Math.round(revenue),
      // No existe todavía una tabla de pagos en la base de datos.
      // Este número es un ESTIMADO (precio x asientos reservados confirmados),
      // no un monto realmente cobrado. Ajustar cuando exista esa tabla.
      paid: null as number | null,
      pending: null as number | null,
      trend,
      topRoutes,
    };
  }

  private client(user: AuthenticatedUser): ReportsClient {
    return this.supabase.forUser(user.accessToken);
  }
}
