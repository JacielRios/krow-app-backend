/*
 * Las relaciones embebidas de PostgREST aún no están descritas en el
 * subconjunto local de database.types.ts. Los resultados se normalizan en
 * este único borde de infraestructura antes de salir hacia el móvil.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';

type LooseClient = SupabaseClient<any, 'public', any>;

const RIDE_HEADER_COLUMNS =
  'ride_id, driver_id, departure_time, available_seats, price_per_seat, status, origin_address, destination_address';
const RIDE_MAP_COLUMNS = `${RIDE_HEADER_COLUMNS}, origin_lat, origin_lng, destination_lat, destination_lng, route_polyline`;
const DRIVER_ACTIVE_STATUSES = ['scheduled', 'full', 'in_progress'];
const PASSENGER_ACTIVE_STATUSES = ['pending', 'confirmed', 'in_progress'];

@Injectable()
export class RideViewsService {
  constructor(private readonly supabase: SupabaseService) {}

  async recent(user: AuthenticatedUser, limit: number) {
    const client = this.client(user);
    const driverId = await this.driverId(client, user.id);

    if (driverId) {
      const { data, error } = await client
        .from('rides')
        .select(
          'ride_id, status, departure_time, origin_lat, origin_lng, destination_lat, destination_lng, available_seats, price_per_seat',
        )
        .eq('driver_id', driverId)
        .order('departure_time', { ascending: false })
        .limit(limit);
      this.throwIfError(error);
      return (data ?? []).map((ride: any) => this.mapRecentRide(ride));
    }

    const { data, error } = await client
      .from('bookings')
      .select(
        `seats_reserved, ride:rides(ride_id, status, departure_time, origin_lat, origin_lng, destination_lat, destination_lng, available_seats, price_per_seat)`,
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    this.throwIfError(error);

    return (data ?? [])
      .map((booking: any) => {
        const ride = this.flatten<any>(booking.ride);
        return ride
          ? this.mapRecentRide({
              ...ride,
              available_seats: booking.seats_reserved,
            })
          : null;
      })
      .filter((ride: unknown) => ride !== null);
  }

  async active(user: AuthenticatedUser) {
    const client = this.client(user);
    const driverId = await this.driverId(client, user.id);

    if (driverId) {
      const { data, error } = await client
        .from('rides')
        .select(
          'ride_id, status, departure_time, origin_address, destination_address',
        )
        .eq('driver_id', driverId)
        .in('status', DRIVER_ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      this.throwIfError(error);
      return data ? this.mapActiveRide(data, 'driver') : null;
    }

    const { data, error } = await client
      .from('bookings')
      .select(
        'ride:rides!inner(ride_id, status, departure_time, origin_address, destination_address)',
      )
      .eq('user_id', user.id)
      .in('status', PASSENGER_ACTIVE_STATUSES)
      .neq('rides.status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    this.throwIfError(error);
    const ride = this.flatten<any>(data?.ride);
    return ride ? this.mapActiveRide(ride, 'passenger') : null;
  }

  async scheduled(user: AuthenticatedUser, rideId: string) {
    const client = this.client(user);
    const driverId = await this.driverId(client, user.id);
    const ride = await this.rideHeader(client, rideId);

    if (driverId && ride.driver_id === driverId) {
      const { data, error } = await client
        .from('bookings')
        .select(
          `booking_id, ride_id, user_id, status, seats_reserved, created_at,
           passenger:users!bookings_user_id_fkey(uuid, full_name, profile_photo, rating)`,
        )
        .eq('ride_id', rideId)
        .in('status', ['pending', 'confirmed'])
        .order('created_at', { ascending: false });
      this.throwIfError(error);
      const bookings = (data ?? []).map((row: any) =>
        this.mapBookingRequest(row),
      );
      return {
        role: 'conductor',
        ride: this.mapRideHeader(ride),
        pendingBookings: bookings.filter(
          (booking: any) => booking.status === 'pending',
        ),
        confirmedBookings: bookings.filter(
          (booking: any) => booking.status === 'confirmed',
        ),
      };
    }

    const [{ data: detailedRide, error: rideError }, booking] =
      await Promise.all([
        client
          .from('rides')
          .select(
            `${RIDE_HEADER_COLUMNS}, vehicle_id,
             driver_profile:driver_profiles!rides_driver_id_fkey(
               driver_id, rating,
               user:users!driver_profiles_user_id_fkey(uuid, full_name, profile_photo, rating)
             ),
             vehicle:vehicles!rides_vehicle_id_fkey(vehicle_id, brand, model, license_plate, car_color)`,
          )
          .eq('ride_id', rideId)
          .maybeSingle(),
        client
          .from('bookings')
          .select('booking_id, status, seats_reserved, created_at')
          .eq('ride_id', rideId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    this.throwIfError(rideError);
    this.throwIfError(booking.error);
    if (!booking.data) {
      throw new NotFoundException('No tienes una reserva en este viaje');
    }

    const profile = this.flatten<any>(detailedRide?.driver_profile);
    const driverUser = this.flatten<any>(profile?.user);
    const vehicle = this.flatten<any>(detailedRide?.vehicle);
    return {
      role: 'pasajero',
      ride: this.mapRideHeader(detailedRide),
      myBooking: {
        bookingId: booking.data.booking_id,
        status: booking.data.status,
        seatsReserved: booking.data.seats_reserved,
        createdAt: booking.data.created_at,
      },
      conductorInfo: driverUser
        ? {
            userId: driverUser.uuid,
            fullName: driverUser.full_name,
            profilePhoto: driverUser.profile_photo,
            rating: this.nullableNumber(profile?.rating ?? driverUser.rating),
          }
        : null,
      vehicleInfo: vehicle
        ? {
            vehicleId: vehicle.vehicle_id,
            brand: vehicle.brand,
            model: vehicle.model,
            color: vehicle.car_color,
            licensePlate: vehicle.license_plate,
          }
        : null,
    };
  }

  async activeData(user: AuthenticatedUser, rideId: string) {
    const client = this.client(user);
    const driverId = await this.driverId(client, user.id);
    const ride = await this.rideMap(client, rideId);

    if (driverId && ride.driver_id === driverId) {
      const { data, error } = await client
        .from('bookings')
        .select(
          `booking_id, user_id, status, seats_reserved,
           dropoff_stop:ride_stops!bookings_dropoff_stop_id_fkey(lat, lng, address),
           passenger:users!bookings_user_id_fkey(uuid, full_name, profile_photo, rating)`,
        )
        .eq('ride_id', rideId)
        .in('status', ['confirmed', 'in_progress'])
        .order('created_at', { ascending: true });
      this.throwIfError(error);
      return {
        role: 'conductor',
        ride: this.mapRideHeader(ride, true),
        passengers: (data ?? []).map((row: any) => {
          const passenger = this.flatten<any>(row.passenger);
          const stop = this.flatten<any>(row.dropoff_stop);
          return {
            bookingId: row.booking_id,
            bookingStatus: row.status,
            userId: passenger?.uuid ?? row.user_id,
            fullName: passenger?.full_name ?? null,
            profilePhoto: passenger?.profile_photo ?? null,
            rating: this.nullableNumber(passenger?.rating),
            seatsReserved: row.seats_reserved,
            dropoffLat: this.number(stop?.lat),
            dropoffLng: this.number(stop?.lng),
            dropoffAddress: stop?.address ?? null,
          };
        }),
      };
    }

    const [{ data: detailedRide, error: rideError }, booking] =
      await Promise.all([
        client
          .from('rides')
          .select(
            `${RIDE_MAP_COLUMNS},
             driver_profile:driver_profiles!rides_driver_id_fkey(
               driver_id, rating,
               driver_user:users!driver_profiles_user_id_fkey(uuid, full_name, profile_photo, rating)
             ),
             vehicle:vehicles!rides_vehicle_id_fkey(vehicle_id, brand, model, car_color, license_plate)`,
          )
          .eq('ride_id', rideId)
          .maybeSingle(),
        client
          .from('bookings')
          .select(
            'booking_id, status, dropoff_stop:ride_stops!bookings_dropoff_stop_id_fkey(lat, lng, address)',
          )
          .eq('ride_id', rideId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    this.throwIfError(rideError);
    this.throwIfError(booking.error);
    if (!booking.data) {
      throw new NotFoundException('No tienes una reserva en este viaje');
    }

    const profile = this.flatten<any>(detailedRide?.driver_profile);
    const driverUser = this.flatten<any>(profile?.driver_user);
    const vehicle = this.flatten<any>(detailedRide?.vehicle);
    const stop = this.flatten<any>(booking.data.dropoff_stop);
    return {
      role: 'pasajero',
      ride: this.mapRideHeader(detailedRide, true),
      myBooking: {
        bookingId: booking.data.booking_id,
        status: booking.data.status,
        dropoffLat: stop ? this.number(stop.lat) : null,
        dropoffLng: stop ? this.number(stop.lng) : null,
        dropoffAddress: stop?.address ?? null,
      },
      driver: {
        userId: driverUser?.uuid ?? '',
        fullName: driverUser?.full_name ?? null,
        profilePhoto: driverUser?.profile_photo ?? null,
        rating: this.nullableNumber(profile?.rating ?? driverUser?.rating),
        vehicleBrand: vehicle?.brand ?? null,
        vehicleModel: vehicle?.model ?? null,
        vehicleColor: vehicle?.car_color ?? null,
        vehicleLicensePlate: vehicle?.license_plate ?? null,
      },
    };
  }

  private client(user: AuthenticatedUser): LooseClient {
    return this.supabase.forUser(user.accessToken) as LooseClient;
  }

  private async driverId(client: LooseClient, userId: string) {
    const { data, error } = await client
      .from('driver_profiles')
      .select('driver_id')
      .eq('user_id', userId)
      .maybeSingle();
    this.throwIfError(error);
    return data?.driver_id as string | undefined;
  }

  private async rideHeader(client: LooseClient, rideId: string) {
    return this.ride(client, rideId, RIDE_HEADER_COLUMNS);
  }

  private async rideMap(client: LooseClient, rideId: string) {
    return this.ride(client, rideId, RIDE_MAP_COLUMNS);
  }

  private async ride(client: LooseClient, rideId: string, columns: string) {
    const { data, error } = await client
      .from('rides')
      .select(columns)
      .eq('ride_id', rideId)
      .maybeSingle();
    this.throwIfError(error);
    if (!data) throw new NotFoundException('Viaje no encontrado');
    return data as any;
  }

  private mapRecentRide(ride: any) {
    return {
      rideId: ride.ride_id,
      status: ride.status ?? 'scheduled',
      departureTime: ride.departure_time,
      originLabel: this.locationLabel(ride.origin_lat, ride.origin_lng),
      destinationLabel: this.locationLabel(
        ride.destination_lat,
        ride.destination_lng,
      ),
      seats: ride.available_seats ?? 0,
      pricePerSeat: this.nullableNumber(ride.price_per_seat),
    };
  }

  private mapActiveRide(ride: any, role: 'driver' | 'passenger') {
    return {
      rideId: ride.ride_id,
      status: ride.status ?? 'scheduled',
      role,
      originAddress: ride.origin_address,
      destinationAddress: ride.destination_address,
      departureTime: ride.departure_time,
    };
  }

  private mapRideHeader(ride: any, includeMap = false) {
    const result: Record<string, unknown> = {
      rideId: ride.ride_id,
      driverId: ride.driver_id,
      departureTime: ride.departure_time,
      availableSeats: ride.available_seats,
      pricePerSeat: this.number(ride.price_per_seat),
      status: ride.status,
      originAddress: ride.origin_address,
      destinationAddress: ride.destination_address,
    };
    if (includeMap) {
      result.originLat = this.nullableNumber(ride.origin_lat);
      result.originLng = this.nullableNumber(ride.origin_lng);
      result.destinationLat = this.nullableNumber(ride.destination_lat);
      result.destinationLng = this.nullableNumber(ride.destination_lng);
      result.routePolyline = ride.route_polyline;
    }
    return result;
  }

  private mapBookingRequest(row: any) {
    const passenger = this.flatten<any>(row.passenger);
    return {
      bookingId: row.booking_id,
      rideId: row.ride_id,
      status: row.status,
      seatsReserved: row.seats_reserved,
      createdAt: row.created_at,
      passenger: {
        userId: row.user_id,
        fullName: passenger?.full_name ?? null,
        profilePhoto: passenger?.profile_photo ?? null,
        rating: this.nullableNumber(passenger?.rating),
      },
    };
  }

  private flatten<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }

  private number(value: unknown, fallback = 0) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private nullableNumber(value: unknown): number | null {
    return value == null ? null : this.number(value);
  }

  private locationLabel(lat: unknown, lng: unknown) {
    if (lat == null || lng == null) return 'Ubicación no disponible';
    return `${this.number(lat).toFixed(4)}, ${this.number(lng).toFixed(4)}`;
  }

  private throwIfError(error: { message: string } | null) {
    if (error) throw new BadRequestException(error.message);
  }
}
