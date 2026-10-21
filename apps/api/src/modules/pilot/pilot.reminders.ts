import type { PilotDatabase } from './pilot.database.js';

// A bounded due-window scan reuses the durable outbox and its unique event key.
// Departure forms part of the key: editing a date invalidates the old reminder.
export function enqueueRideReminders(db: PilotDatabase) {
  return db.query(`with participants as (
    select r.ride_id,null::uuid as booking_id,d.user_id as recipient_id,r.departure_time
    from public.rides r join public.driver_profiles d using(driver_id)
    where r.status in ('scheduled','full') and r.departure_time>now()
      and r.departure_time<=now()+interval '30 minutes'
    union all
    select r.ride_id,b.booking_id,b.user_id,r.departure_time
    from public.rides r join public.bookings b using(ride_id)
    where r.status in ('scheduled','full') and b.status='confirmed'
      and r.departure_time>now() and r.departure_time<=now()+interval '30 minutes'
  ) insert into krow_pilot.outbox(event_key,ride_id,booking_id,recipient_id,kind,expires_at)
    select 'reminder:'||p.ride_id::text||':'||extract(epoch from p.departure_time)::text,
      p.ride_id,p.booking_id,p.recipient_id,'reminder',p.departure_time
    from participants p join public.users u on u.uuid=p.recipient_id
    where u.is_active is distinct from false and u.deleted_at is null
    on conflict(event_key,recipient_id) do nothing returning intent_id`);
}

export async function reminderIsCurrent(
  db: PilotDatabase,
  intent: {
    ride_id: string;
    booking_id: string | null;
    recipient_id: string;
    event_key: string;
  },
) {
  const rows = await db.query<{ current: boolean }>(
    `select true as current from public.rides r join public.driver_profiles d using(driver_id)
     where r.ride_id=$1 and r.status in ('scheduled','full') and r.departure_time>now()
     and 'reminder:'||r.ride_id::text||':'||extract(epoch from r.departure_time)::text=$4
     and (($2::uuid is null and d.user_id=$3) or exists (
       select 1 from public.bookings b where b.booking_id=$2 and b.ride_id=r.ride_id
       and b.user_id=$3 and b.status='confirmed'))`,
    [intent.ride_id, intent.booking_id, intent.recipient_id, intent.event_key],
  );
  return rows[0]?.current === true;
}
