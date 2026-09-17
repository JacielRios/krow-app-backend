import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type {
  CreateRideDto,
  SearchRidesDto,
} from '../presentation/ride.dto.js';
import { MatchingService } from '../../matching/matching.service.js';
import type { SearchRideRow } from '../../../infrastructure/supabase/database.types.js';

@Injectable()
export class RidesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly matching: MatchingService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateRideDto) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('create_ride', {
        p_payload: {
          vehicle_id: dto.vehicleId,
          origin_lat: dto.origin.lat,
          origin_lng: dto.origin.lng,
          destination_lat: dto.destination.lat,
          destination_lng: dto.destination.lng,
          origin_address: dto.originAddress,
          destination_address: dto.destinationAddress,
          route_polyline: dto.routePolyline,
          departure_time: dto.departureTime,
          available_seats: dto.availableSeats,
          price_per_seat: dto.pricePerSeatCents / 100,
        },
      });
    if (error) throw new BadRequestException(error.message);
    return { rideId: data };
  }

  async findOne(user: AuthenticatedUser, rideId: string) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('rides')
      .select('*')
      .eq('ride_id', rideId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Viaje no encontrado');
    return data;
  }

  async search(user: AuthenticatedUser, dto: SearchRidesDto) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('search_available_rides', {
        p_max_results: dto.maxResults,
        p_from_time: dto.fromTime ?? null,
        p_to_time: dto.toTime ?? null,
      });
    if (error) throw new BadRequestException(error.message);

    return (data ?? [])
      .map((row) => this.mapSearchRow(row, dto))
      .filter(
        (ride) =>
          ride.match.originDistanceKm <= dto.maxDistanceKm &&
          ride.match.destinationDistanceKm <= dto.maxDistanceKm,
      )
      .sort((a, b) => b.match.score - a.match.score);
  }

  async start(user: AuthenticatedUser, rideId: string) {
    const { error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('start_ride', { p_ride_id: rideId });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async cancel(user: AuthenticatedUser, rideId: string, reason?: string) {
    const { error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('cancel_ride', {
        p_ride_id: rideId,
        ...(reason ? { p_reason: reason } : {}),
      });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async complete(user: AuthenticatedUser, rideId: string) {
    const { error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('complete_ride', { p_ride_id: rideId });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async completeStop(
    user: AuthenticatedUser,
    rideId: string,
    bookingId: string,
  ) {
    const client = this.supabase.forUser(user.accessToken);
    const { data: booking, error: bookingError } = await client
      .from('bookings')
      .select('ride_id')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (bookingError) throw new BadRequestException(bookingError.message);
    if (!booking || booking.ride_id !== rideId)
      throw new NotFoundException('Parada o reserva no encontrada en el viaje');

    const { error } = await client.rpc('complete_stop', {
      p_booking_id: bookingId,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  private mapSearchRow(row: SearchRideRow, dto: SearchRidesDto) {
    const rideOrigin = {
      lat: Number(row.origin_lat),
      lng: Number(row.origin_lng),
    };
    const rideDestination = {
      lat: Number(row.destination_lat),
      lng: Number(row.destination_lng),
    };
    const match = this.matching.score(
      dto.origin,
      dto.destination,
      rideOrigin,
      rideDestination,
    );
    return {
      rideId: row.ride_id,
      driverId: row.driver_id,
      driverName: row.driver_name,
      driverRating:
        row.driver_rating == null ? null : Number(row.driver_rating),
      vehicle: row.vehicle_id
        ? {
            vehicleId: row.vehicle_id,
            brand: row.vehicle_brand,
            model: row.vehicle_model,
            licensePlate: row.vehicle_plate,
            color: row.vehicle_color,
          }
        : null,
      origin: rideOrigin,
      destination: rideDestination,
      originAddress: row.origin_address,
      destinationAddress: row.destination_address,
      routePolyline: row.route_polyline,
      departureTime: row.departure_time,
      availableSeats: Number(row.available_seats),
      pricePerSeatCents: Math.round(Number(row.price_per_seat) * 100),
      status: row.status,
      match,
    };
  }
}
