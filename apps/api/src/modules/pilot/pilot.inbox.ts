import type { PilotDatabase } from './pilot.database.js';

// Read server truth, including when push never arrived. An outbox row identifies
// a passenger response; delivery status is deliberately irrelevant to recovery.
export function bookingInbox(
  db: PilotDatabase,
  actorId: string,
  bookingId?: string,
) {
  return db.query(
    `select b.booking_id as "bookingId",r.ride_id as "rideId",b.status,
      case when d.user_id=$1 then 'driver' else 'passenger' end as role,
      b.booking_id::text||':'||b.status as "eventKey",b.created_at as "createdAt",
      b.seats_reserved as seats,p.amount_cents as "amountCents",
      passenger.full_name as "passengerName",du.full_name as "driverName",
      concat_ws(' · ',v.brand,v.model,v.car_color,v.license_plate) as vehicle,
      r.origin_address as origin,r.destination_address as destination,
      r.departure_time as "departureTime",r.status as "rideStatus",
      pickup.address as "pickupAddress",dropoff.address as "dropoffAddress",
      (d.user_id=$1 and b.status='pending' and r.status in ('scheduled','full')
        and r.departure_time>clock_timestamp()) as "canRespond"
    from public.bookings b join public.rides r using(ride_id)
    join public.driver_profiles d using(driver_id)
    join public.users actor on actor.uuid=$1 and actor.is_active is distinct from false and actor.deleted_at is null
    join public.users passenger on passenger.uuid=b.user_id
    join public.users du on du.uuid=d.user_id join public.vehicles v using(vehicle_id)
    join public.ride_stops pickup on pickup.stop_id=b.pickup_stop_id
    join public.ride_stops dropoff on dropoff.stop_id=b.dropoff_stop_id
    join krow_pilot.booking_prices p using(booking_id)
    where (d.user_id=$1 or b.user_id=$1) and (
      ($2::uuid is not null and b.booking_id=$2) or
      ($2::uuid is null and (
        (d.user_id=$1 and b.status='pending' and r.status in ('scheduled','full') and r.departure_time>clock_timestamp()) or
        (b.user_id=$1 and b.status in ('confirmed','rejected','cancelled') and exists(
          select 1 from krow_pilot.outbox o where o.booking_id=b.booking_id and o.recipient_id=$1
          and o.kind='booking' and o.event_key=b.booking_id::text||':'||b.status
          and o.expires_at>now()-interval '7 days'))
      )))
    order by (b.status='pending') desc,b.created_at desc,b.booking_id limit 50`,
    [actorId, bookingId ?? null],
  );
}
