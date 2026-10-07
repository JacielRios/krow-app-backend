import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { PilotService } from '../../pilot/pilot.service.js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type { BookingStatus } from '../domain/booking-state.js';
import type { RequestBookingDto } from '../presentation/booking.dto.js';

@Injectable()
export class BookingsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly pilot?: PilotService,
  ) {}

  async request(
    user: AuthenticatedUser,
    rideId: string,
    dto: RequestBookingDto,
  ) {
    if (this.pilot?.db.enabled)
      return {
        bookingId: await this.pilot.db.routeRpc(user.id, 'request_booking_v2', [
          {
            ride_id: rideId,
            seats_reserved: dto.seats,
            pickup_stop_id: dto.pickupStopId,
            dropoff_stop_id: dto.dropoffStopId,
          },
        ]),
      };
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('request_booking_v2', {
        p_payload: {
          ride_id: rideId,
          seats_reserved: dto.seats,
          pickup_stop_id: dto.pickupStopId,
          dropoff_stop_id: dto.dropoffStopId,
        },
      });
    if (error) throw new BadRequestException(error.message);
    return { bookingId: data };
  }

  async accept(user: AuthenticatedUser, bookingId: string, reason?: string) {
    return this.update(user, bookingId, 'confirmed', reason);
  }
  async reject(user: AuthenticatedUser, bookingId: string, reason?: string) {
    return this.update(user, bookingId, 'rejected', reason);
  }
  async cancel(user: AuthenticatedUser, bookingId: string, reason?: string) {
    return this.update(user, bookingId, 'cancelled', reason);
  }

  async pendingCount(user: AuthenticatedUser) {
    const client = this.supabase.forUser(user.accessToken);
    const { data: driver, error: driverError } = await client
      .from('driver_profiles')
      .select('driver_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (driverError) throw new BadRequestException(driverError.message);
    if (!driver) return { count: 0 };
    const { data: rides, error: ridesError } = await client
      .from('rides')
      .select('ride_id')
      .eq('driver_id', driver.driver_id);
    if (ridesError) throw new BadRequestException(ridesError.message);
    const rideIds = (rides ?? []).map((ride) => ride.ride_id);
    if (rideIds.length === 0) return { count: 0 };
    const { count, error } = await client
      .from('bookings')
      .select('booking_id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .in('ride_id', rideIds);
    if (error) throw new BadRequestException(error.message);
    return { count: count ?? 0 };
  }

  async activeRideIds(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('bookings')
      .select('ride_id, status')
      .eq('user_id', user.id)
      .in('status', ['pending', 'confirmed']);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async update(
    user: AuthenticatedUser,
    bookingId: string,
    target: BookingStatus,
    reason?: string,
  ) {
    if (this.pilot?.db.enabled)
      return this.pilot.updateBooking(user, bookingId, target, reason);
    const client = this.supabase.forUser(user.accessToken);
    const { error } = await client.rpc('update_booking_status', {
      p_booking_id: bookingId,
      p_new_status: target,
      ...(reason ? { p_reason: reason } : {}),
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
