import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { Database } from '../../../infrastructure/supabase/database.types.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { RoutesService } from '../../routes/application/routes.service.js';
import type {
  CreateRideDto,
  DriverRidesQueryDto,
  RideStopOptionsDto,
  SearchRidesDto,
  UpdateRideDto,
} from '../presentation/ride.dto.js';

type RidesClient = SupabaseClient<Database>;
type RideRow = Database['public']['Tables']['rides']['Row'];
type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
type RideStopRow = Database['public']['Tables']['ride_stops']['Row'];
type TransportStopRow = Database['public']['Tables']['transport_stops']['Row'];
type VehicleView = Pick<
  VehicleRow,
  'vehicle_id' | 'brand' | 'model' | 'license_plate' | 'car_color' | 'capacity'
> &
  Partial<Pick<VehicleRow, 'car_year'>>;
type RideStopView = Pick<
  RideStopRow,
  | 'stop_id'
  | 'stop_order'
  | 'is_active'
  | 'route_fraction'
  | 'lat'
  | 'lng'
  | 'address'
  | 'transport_stop_id'
> & {
  transport_stop:
    | Pick<TransportStopRow, 'name' | 'municipality' | 'active'>
    | Array<Pick<TransportStopRow, 'name' | 'municipality' | 'active'>>
    | null;
};
type BookingStatusView = { status: string };
type RideDetailRow = RideRow & {
  vehicle: VehicleView | VehicleView[] | null;
  ride_stops: RideStopView[];
  bookings: BookingStatusView[];
};
type DriverRideRow = Pick<
  RideRow,
  | 'ride_id'
  | 'origin_address'
  | 'destination_address'
  | 'departure_time'
  | 'available_seats'
  | 'price_per_seat'
  | 'status'
  | 'version'
  | 'route_distance_meters'
  | 'route_duration_seconds'
> & {
  vehicle: VehicleView | VehicleView[] | null;
  bookings: BookingStatusView[];
};
type StopPairRow = {
  pickup_stop_id: string;
  pickup_stop_name: string;
  pickup_stop_address: string | null;
  pickup_stop_lat: number;
  pickup_stop_lng: number;
  pickup_distance_m: number;
  dropoff_stop_id: string;
  dropoff_stop_name: string;
  dropoff_stop_address: string | null;
  dropoff_stop_lat: number;
  dropoff_stop_lng: number;
  dropoff_distance_m: number;
};
type SearchRideRow = StopPairRow &
  Pick<
    RideRow,
    | 'ride_id'
    | 'driver_id'
    | 'origin_lat'
    | 'origin_lng'
    | 'destination_lat'
    | 'destination_lng'
    | 'origin_address'
    | 'destination_address'
    | 'route_polyline'
    | 'route_distance_meters'
    | 'route_duration_seconds'
    | 'departure_time'
    | 'available_seats'
    | 'price_per_seat'
    | 'status'
  > & {
    driver_name: string | null;
    driver_rating: number | null;
    vehicle_id: string;
    vehicle_brand: string;
    vehicle_model: string;
    vehicle_plate: string;
    vehicle_color: string;
    vehicle_capacity: number;
  };
const EDIT_BLOCKING_BOOKINGS = ['pending', 'confirmed', 'in_progress'];

@Injectable()
export class RidesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly routes: RoutesService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateRideDto) {
    const computed = await this.routes.compute({
      origin: dto.origin,
      destination: dto.destination,
      departureTime: dto.departureTime,
    });
    const { data, error } = await this.client(user).rpc('create_ride_v2', {
      p_payload: this.ridePayload(dto, computed),
    });
    if (error) this.throwRpcError(error.message);
    return { rideId: data };
  }

  async update(user: AuthenticatedUser, rideId: string, dto: UpdateRideDto) {
    const computed = await this.routes.compute({
      origin: dto.origin,
      destination: dto.destination,
      departureTime: dto.departureTime,
    });
    const { data, error } = await this.client(user).rpc('update_ride_v2', {
      p_ride_id: rideId,
      p_expected_version: dto.version,
      p_payload: this.ridePayload(dto, computed),
    });
    if (error) this.throwRpcError(error.message);
    return { rideId, version: data };
  }

  async findOne(user: AuthenticatedUser, rideId: string) {
    const { data, error } = await this.client(user)
      .from('rides')
      .select(
        `*,
         vehicle:vehicles(
           vehicle_id, brand, model, car_year, license_plate, car_color, capacity
         ),
         ride_stops(
           stop_id, stop_order, route_version, is_active, route_fraction,
           lat, lng, address, transport_stop_id,
           transport_stop:transport_stops(
             stop_id, external_id, name, address, municipality, active
           )
         ),
         bookings(status)`,
      )
      .eq('ride_id', rideId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Viaje no encontrado');
    const { data: driver, error: driverError } = await this.client(user)
      .from('driver_profiles')
      .select('driver_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (driverError) throw new BadRequestException(driverError.message);
    return this.mapRideDetail(
      data as unknown as RideDetailRow,
      driver?.driver_id === data.driver_id,
    );
  }

  async mine(user: AuthenticatedUser, query: DriverRidesQueryDto) {
    const client = this.client(user);
    const { data: driver, error: driverError } = await client
      .from('driver_profiles')
      .select('driver_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (driverError) throw new BadRequestException(driverError.message);
    if (!driver)
      throw new NotFoundException('Perfil de conductor no encontrado');

    let request = client
      .from('rides')
      .select(
        `ride_id, departure_time, origin_address, destination_address,
         available_seats, price_per_seat, status, version,
         route_distance_meters, route_duration_seconds,
         vehicle:vehicles(vehicle_id, brand, model, license_plate, car_color, capacity),
         bookings(status)`,
      )
      .eq('driver_id', driver.driver_id)
      .order('departure_time', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);
    if (query.status) request = request.eq('status', query.status);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as DriverRideRow[];
    return rows.map((ride) => this.mapDriverRide(ride));
  }

  async search(user: AuthenticatedUser, dto: SearchRidesDto) {
    const { data, error } = await this.client(user).rpc(
      'search_available_rides_v2',
      {
        p_origin_lat: dto.origin.lat,
        p_origin_lng: dto.origin.lng,
        p_destination_lat: dto.destination.lat,
        p_destination_lng: dto.destination.lng,
        p_max_results: dto.maxResults,
        p_from_time: dto.fromTime ?? null,
        p_to_time: dto.toTime ?? null,
        p_max_distance_m: dto.maxDistanceMeters,
      },
    );
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as SearchRideRow[];
    return rows.map((row) => this.mapSearchRow(row));
  }

  async stopOptions(
    user: AuthenticatedUser,
    rideId: string,
    dto: RideStopOptionsDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'get_ride_stop_options',
      {
        p_ride_id: rideId,
        p_origin_lat: dto.origin.lat,
        p_origin_lng: dto.origin.lng,
        p_destination_lat: dto.destination.lat,
        p_destination_lng: dto.destination.lng,
        p_max_distance_m: dto.maxDistanceMeters,
      },
    );
    if (error) throw new BadRequestException(error.message);
    return {
      pairs: ((data ?? []) as unknown as StopPairRow[]).map((pair) => ({
        pickup: this.mapStopOption(pair, 'pickup'),
        dropoff: this.mapStopOption(pair, 'dropoff'),
      })),
    };
  }

  async start(user: AuthenticatedUser, rideId: string) {
    const { error } = await this.client(user).rpc('start_ride', {
      p_ride_id: rideId,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async cancel(user: AuthenticatedUser, rideId: string, reason?: string) {
    const { error } = await this.client(user).rpc('cancel_ride', {
      p_ride_id: rideId,
      ...(reason ? { p_reason: reason } : {}),
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async complete(user: AuthenticatedUser, rideId: string) {
    const { error } = await this.client(user).rpc('complete_ride', {
      p_ride_id: rideId,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async completeStop(
    user: AuthenticatedUser,
    rideId: string,
    bookingId: string,
  ) {
    const client = this.client(user);
    const { data: booking, error: bookingError } = await client
      .from('bookings')
      .select('ride_id')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (bookingError) throw new BadRequestException(bookingError.message);
    if (!booking || booking.ride_id !== rideId) {
      throw new NotFoundException('Parada o reserva no encontrada en el viaje');
    }
    const { error } = await client.rpc('complete_stop', {
      p_booking_id: bookingId,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  private ridePayload(
    dto: CreateRideDto,
    computed: Awaited<ReturnType<RoutesService['compute']>>,
  ) {
    return {
      vehicle_id: dto.vehicleId,
      favorite_route_id: dto.favoriteRouteId,
      origin_lat: dto.origin.lat,
      origin_lng: dto.origin.lng,
      destination_lat: dto.destination.lat,
      destination_lng: dto.destination.lng,
      origin_address: dto.originAddress,
      destination_address: dto.destinationAddress,
      route_polyline: computed.preview.encodedPolyline,
      route_geojson: computed.routeGeoJson,
      route_distance_meters: computed.preview.distanceMeters,
      route_duration_seconds: computed.preview.durationSeconds,
      route_provider: computed.preview.provider,
      route_calculated_at: computed.preview.calculatedAt,
      departure_time: dto.departureTime,
      available_seats: dto.availableSeats,
      price_per_seat: dto.pricePerSeatCents / 100,
      transport_stop_ids: dto.transportStopIds,
    };
  }

  private mapRideDetail(ride: RideDetailRow, isOwner: boolean) {
    const bookings = ride.bookings ?? [];
    const activeBookings = bookings.filter((booking) =>
      EDIT_BLOCKING_BOOKINGS.includes(booking.status),
    );
    const stops = (ride.ride_stops ?? [])
      .filter((stop) => stop.is_active)
      .sort((a, b) => a.stop_order - b.stop_order)
      .map((stop) => {
        const catalog = this.flatten(stop.transport_stop);
        return {
          stopId: stop.stop_id,
          transportStopId: stop.transport_stop_id,
          stopOrder: stop.stop_order,
          routeFraction: stop.route_fraction,
          name: catalog?.name ?? stop.address,
          address: stop.address,
          municipality: catalog?.municipality ?? null,
          location: { lat: Number(stop.lat), lng: Number(stop.lng) },
          active: catalog ? Boolean(catalog.active) : false,
        };
      });
    const canEdit =
      isOwner && ride.status === 'scheduled' && activeBookings.length === 0;
    return {
      rideId: ride.ride_id,
      favoriteRouteId: ride.favorite_route_id,
      origin: {
        lat: Number(ride.origin_lat),
        lng: Number(ride.origin_lng),
        address: ride.origin_address,
      },
      destination: {
        lat: Number(ride.destination_lat),
        lng: Number(ride.destination_lng),
        address: ride.destination_address,
      },
      routePolyline: ride.route_polyline,
      routeDistanceMeters: ride.route_distance_meters,
      routeDurationSeconds: ride.route_duration_seconds,
      routeCalculatedAt: ride.route_calculated_at,
      departureTime: ride.departure_time,
      availableSeats: ride.available_seats,
      pricePerSeatCents: Math.round(Number(ride.price_per_seat) * 100),
      status: ride.status,
      version: ride.version,
      vehicle: this.flatten(ride.vehicle),
      stops,
      canEdit,
      editBlockReason: canEdit
        ? null
        : !isOwner
          ? 'Solo el conductor del viaje puede editarlo'
          : ride.status !== 'scheduled'
            ? 'El viaje ya no está programado'
            : 'El viaje tiene reservaciones activas',
    };
  }

  private mapDriverRide(ride: DriverRideRow) {
    const activeBookings = (ride.bookings ?? []).filter((booking) =>
      EDIT_BLOCKING_BOOKINGS.includes(booking.status),
    ).length;
    return {
      rideId: ride.ride_id,
      originAddress: ride.origin_address,
      destinationAddress: ride.destination_address,
      departureTime: ride.departure_time,
      availableSeats: ride.available_seats,
      pricePerSeatCents: Math.round(Number(ride.price_per_seat) * 100),
      status: ride.status,
      version: ride.version,
      routeDistanceMeters: ride.route_distance_meters,
      routeDurationSeconds: ride.route_duration_seconds,
      vehicle: this.flatten(ride.vehicle),
      canEdit: ride.status === 'scheduled' && activeBookings === 0,
      activeBookings,
    };
  }

  private mapSearchRow(row: SearchRideRow) {
    return {
      rideId: row.ride_id,
      driverId: row.driver_id,
      driverName: row.driver_name,
      driverRating:
        row.driver_rating == null ? null : Number(row.driver_rating),
      vehicle: {
        vehicleId: row.vehicle_id,
        brand: row.vehicle_brand,
        model: row.vehicle_model,
        licensePlate: row.vehicle_plate,
        color: row.vehicle_color,
        capacity: row.vehicle_capacity,
      },
      origin: { lat: Number(row.origin_lat), lng: Number(row.origin_lng) },
      destination: {
        lat: Number(row.destination_lat),
        lng: Number(row.destination_lng),
      },
      originAddress: row.origin_address,
      destinationAddress: row.destination_address,
      routePolyline: row.route_polyline,
      routeDistanceMeters: row.route_distance_meters,
      routeDurationSeconds: row.route_duration_seconds,
      departureTime: row.departure_time,
      availableSeats: Number(row.available_seats),
      pricePerSeatCents: Math.round(Number(row.price_per_seat) * 100),
      status: row.status,
      bestPickupStop: this.mapStopOption(row, 'pickup'),
      bestDropoffStop: this.mapStopOption(row, 'dropoff'),
      match: {
        pickupDistanceMeters: Math.round(Number(row.pickup_distance_m)),
        dropoffDistanceMeters: Math.round(Number(row.dropoff_distance_m)),
      },
    };
  }

  private mapStopOption(row: StopPairRow, prefix: 'pickup' | 'dropoff') {
    return {
      stopId: row[`${prefix}_stop_id`],
      name: row[`${prefix}_stop_name`],
      address: row[`${prefix}_stop_address`],
      location: {
        lat: Number(row[`${prefix}_stop_lat`]),
        lng: Number(row[`${prefix}_stop_lng`]),
      },
      distanceMeters: Math.round(Number(row[`${prefix}_distance_m`])),
    };
  }

  private flatten<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }

  private client(user: AuthenticatedUser): RidesClient {
    return this.supabase.forUser(user.accessToken);
  }

  private throwRpcError(message: string): never {
    if (
      message.toLowerCase().includes('conflicto') ||
      message.toLowerCase().includes('reservas activas')
    ) {
      throw new ConflictException(message);
    }
    throw new BadRequestException(message);
  }
}
