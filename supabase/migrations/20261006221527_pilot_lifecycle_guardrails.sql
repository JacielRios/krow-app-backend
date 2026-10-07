begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Add compatible status/index/closure structures before the API cutover.
-- Business permission changes live in scripts/pilot-api-cutover.sql and must
-- follow activation of the private API login and RIDE_PILOT_ENABLED.
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check
  (status in ('pending','confirmed','rejected','cancelled','in_progress','completed','no_show','interrupted'));
create index if not exists pilot_reviews_subject on public.ride_reviews(reviewee_id);
create index if not exists pilot_activity_passenger on public.bookings(user_id,status,ride_id);
create index if not exists pilot_activity_driver on public.rides(driver_id,status,departure_time,ride_id);
-- Account access closes immediately; approved retention and anonymization are
-- a separate operational processing step, never an invented default period.
create table krow_pilot.account_closure_requests (
  actor_id uuid primary key references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'access_closed' check(status in ('access_closed','processed')),
  processed_at timestamptz
);
alter table krow_pilot.account_closure_requests enable row level security;
revoke all on krow_pilot.account_closure_requests from public,anon,authenticated;


commit;
