begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table krow_pilot.devices(
  device_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  token_encrypted text not null,
  updated_at timestamptz not null default now()
);
create table krow_pilot.outbox(
  intent_id uuid primary key default gen_random_uuid(),
  event_key text not null,
  ride_id uuid not null references public.rides(ride_id),
  booking_id uuid references public.bookings(booking_id),
  recipient_id uuid not null references auth.users(id),
  kind text not null,
  expires_at timestamptz not null default now()+interval '15 minutes',
  attempts integer not null default 0,
  status text not null default 'pending' check(status in('pending','accepted','expired','failed')),
  next_at timestamptz not null default now(),
  lease_until timestamptz,
  unique(event_key,recipient_id)
);
create index pilot_outbox_pending on krow_pilot.outbox(next_at) where status='pending';
create function krow_pilot.booking_notification() returns trigger language plpgsql security definer
set search_path=pg_catalog,public,krow_pilot as $$
declare driver uuid;
begin
  select d.user_id into driver from public.rides r join public.driver_profiles d using(driver_id) where r.ride_id=new.ride_id;
  insert into krow_pilot.outbox(event_key,ride_id,booking_id,recipient_id,kind)
  select new.booking_id::text||':'||new.status, new.ride_id,new.booking_id,recipient,'booking'
  from (values(driver),(new.user_id)) as recipients(recipient)
  on conflict(event_key,recipient_id) do nothing;
  return new;
end; $$;
create trigger pilot_booking_notification after insert or update of status on public.bookings
for each row execute function krow_pilot.booking_notification();
create function krow_pilot.message_notification() returns trigger language plpgsql security definer
set search_path=pg_catalog,public,krow_pilot as $$
begin
  insert into krow_pilot.outbox(event_key,ride_id,booking_id,recipient_id,kind)
  select new.message_id::text,b.ride_id,b.booking_id,case when b.user_id=new.sender_id then d.user_id else b.user_id end,'chat'
  from public.bookings b join public.rides r using(ride_id) join public.driver_profiles d using(driver_id)
  where b.booking_id=new.booking_id;
  return new;
end; $$;
create trigger pilot_message_notification after insert on krow_pilot.messages
for each row execute function krow_pilot.message_notification();
alter table krow_pilot.devices enable row level security;
alter table krow_pilot.outbox enable row level security;
revoke all on all tables in schema krow_pilot from public,anon,authenticated;
revoke all on all functions in schema krow_pilot from public,anon,authenticated;


commit;
