begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Requires the reconciled public schema and all earlier migrations. Never push
-- this ledger to an unknown remote database without a schema diff and backup.
create schema if not exists krow_pilot;
revoke all on schema krow_pilot from public, anon, authenticated;

create table krow_pilot.tracking_sessions (
  ride_id uuid primary key references public.rides(ride_id) on delete cascade,
  session_id uuid not null unique default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  device_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  last_seq bigint not null default -1,
  position jsonb,
  updated_at timestamptz not null default now()
);
create table krow_pilot.messages (
  message_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(booking_id),
  sender_id uuid not null references auth.users(id),
  client_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(booking_id, sender_id, client_id)
);
create index pilot_message_history on krow_pilot.messages(booking_id, created_at, message_id);
create table krow_pilot.cash (
  booking_id uuid primary key references public.bookings(booking_id),
  amount_cents integer not null check(amount_cents >= 0),
  status text not null default 'pending' check(status in ('pending','collected','void')),
  collected_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table krow_pilot.reviews (
  booking_id uuid not null references public.bookings(booking_id),
  author_id uuid not null references auth.users(id),
  review_id uuid not null unique references public.ride_reviews(review_id),
  primary key(booking_id, author_id)
);
create table krow_pilot.booking_prices (
  booking_id uuid primary key references public.bookings(booking_id),
  amount_cents integer not null check(amount_cents >= 0)
);
insert into krow_pilot.booking_prices
select b.booking_id, round(r.price_per_seat * 100)::integer * b.seats_reserved
from public.bookings b join public.rides r using(ride_id);
create function krow_pilot.capture_price() returns trigger language plpgsql security definer
set search_path = pg_catalog, public, krow_pilot as $$
begin
  insert into krow_pilot.booking_prices(booking_id, amount_cents)
  select new.booking_id, round(price_per_seat * 100)::integer * new.seats_reserved
  from public.rides where ride_id = new.ride_id;
  return new;
end; $$;
create trigger pilot_booking_price after insert on public.bookings
for each row execute function krow_pilot.capture_price();
revoke all on all functions in schema krow_pilot from public, anon, authenticated;
alter table krow_pilot.tracking_sessions enable row level security;
alter table krow_pilot.messages enable row level security;
alter table krow_pilot.cash enable row level security;
alter table krow_pilot.reviews enable row level security;
alter table krow_pilot.booking_prices enable row level security;
revoke all on all tables in schema krow_pilot from public, anon, authenticated;
-- Public business privileges are changed separately during API cutover.
-- See scripts/pilot-api-cutover.sql; keep legacy writes available until the
-- private API login is configured and the pilot backend is running.


commit;
