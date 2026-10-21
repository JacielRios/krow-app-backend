import { NotFoundException } from '@nestjs/common';
import type { PilotDatabase } from './pilot.database.js';

export async function rideInvitation(
  db: PilotDatabase,
  actorId: string,
  rideId: string,
) {
  const [ride] = await db.query<{
    rideId: string;
    status: string;
    departureTime: Date;
    origin: string;
    destination: string;
    driverName: string;
    vehicle: string;
    availableSeats: number;
    pricePerSeatCents: number;
    owned: boolean;
    bookingId: string | null;
  }>(
    `select r.ride_id as "rideId",r.status,r.departure_time as "departureTime",
    r.origin_address as origin,r.destination_address as destination,du.full_name as "driverName",
    concat_ws(' · ',v.brand,v.model,v.car_color) as vehicle,r.available_seats as "availableSeats",
    round(r.price_per_seat*100)::integer as "pricePerSeatCents",d.user_id=$1 as owned,
    (select b.booking_id from public.bookings b where b.ride_id=r.ride_id and b.user_id=$1
      and b.status in ('pending','confirmed','in_progress')
      order by b.created_at desc,b.booking_id desc limit 1) as "bookingId"
    from public.rides r join public.driver_profiles d using(driver_id)
    join public.users du on du.uuid=d.user_id join public.vehicles v using(vehicle_id)
    join public.users actor on actor.uuid=$1 and actor.is_active is distinct from false and actor.deleted_at is null
    where r.ride_id=$2 and (d.user_id=$1 or exists(select 1 from public.bookings b where b.ride_id=r.ride_id and b.user_id=$1)
      or (r.status in ('scheduled','full') and r.departure_time>now()
        and du.is_active is distinct from false and du.deleted_at is null))`,
    [actorId, rideId],
  );
  if (!ride) throw new NotFoundException('La invitación ya no está disponible');
  const stops = await db.query<{
    stopId: string;
    order: number;
    address: string;
  }>(
    `select stop_id as "stopId",stop_order as "order",address from public.ride_stops
     where ride_id=$1 and is_active is distinct from false order by stop_order,stop_id`,
    [rideId],
  );
  return {
    ...ride,
    canRequest:
      !ride.owned &&
      !ride.bookingId &&
      ride.status === 'scheduled' &&
      ride.availableSeats > 0 &&
      new Date(ride.departureTime).getTime() > Date.now(),
    stops,
  };
}
