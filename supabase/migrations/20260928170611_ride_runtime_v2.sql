-- Additive, opt-in runtime. Audited against the remote schema on 2026-09-28.
-- Apply after reconciling the existing migration ledger. No ride is enrolled here.
begin;
create schema if not exists krow_runtime;
revoke all on schema krow_runtime from public, anon, authenticated;
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check
  (status in ('pending','confirmed','rejected','cancelled','in_progress','completed','no_show','interrupted'));

create table krow_runtime.rides (
  ride_id uuid primary key references public.rides(ride_id) on delete restrict,
  capacity integer not null check (capacity > 0),
  version integer not null default 1 check (version > 0),
  route_version integer not null default 0,
  state text not null default 'scheduled' check (state in ('scheduled','in_progress','completed','cancelled','interrupted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table krow_runtime.route_versions (
  ride_id uuid not null references krow_runtime.rides on delete cascade,
  version integer not null check (version > 0),
  reason text not null check (reason in ('initial','traffic','closure','deviation','reconciliation')),
  route jsonb not null check (route->>'provider' = 'mapbox'),
  created_at timestamptz not null default now(),
  primary key (ride_id,version)
);
create table krow_runtime.stop_visits (
  ride_id uuid not null references krow_runtime.rides on delete cascade,
  stop_id uuid not null references public.ride_stops(stop_id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','approaching','arrived','servicing','departed','skipped')),
  arrived_at timestamptz,
  departed_at timestamptz,
  primary key (ride_id,stop_id)
);
-- Segment availability is calculated from authoritative reservations under a ride lock.
-- Completed reservations remain in historical capacity; new bookings stop at departure.
create view krow_runtime.ride_segments with (security_invoker = true) as
select r.ride_id,s.stop_id as from_stop_id,n.stop_id as to_stop_id,s.stop_order,
  r.capacity, coalesce(sum(b.seats_reserved),0)::integer as occupied,
  r.capacity-coalesce(sum(b.seats_reserved),0)::integer as available
from krow_runtime.rides r
join public.ride_stops s on s.ride_id=r.ride_id and s.is_active
join lateral (select ns.stop_id from public.ride_stops ns
  where ns.ride_id=r.ride_id and ns.is_active and ns.stop_order>s.stop_order
  order by ns.stop_order limit 1) n on true
left join public.bookings b on b.ride_id=r.ride_id and b.status in ('confirmed','in_progress','completed')
  and (select p.stop_order from public.ride_stops p where p.stop_id=b.pickup_stop_id)<=s.stop_order
  and (select d.stop_order from public.ride_stops d where d.stop_id=b.dropoff_stop_id)>s.stop_order
group by r.ride_id,r.capacity,s.stop_id,n.stop_id,s.stop_order;

create table krow_runtime.commands (
  actor_id uuid not null references public.users(uuid),
  command_id uuid not null,
  ride_id uuid not null references krow_runtime.rides,
  request_hash text not null,
  result jsonb not null,
  request jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id,command_id)
);
create table krow_runtime.outbox_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique default gen_random_uuid(),
  ride_id uuid not null references krow_runtime.rides,
  version integer not null,
  type text not null,
  recipient_ids uuid[] not null default '{}',
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  lease_until timestamptz,
  lease_owner uuid,
  attempts integer not null default 0,
  unique(ride_id,version)
);
create index outbox_unpublished on krow_runtime.outbox_events(id) where published_at is null;
create index outbox_ride_replay on krow_runtime.outbox_events(ride_id,version);
create table krow_runtime.location_sessions (
  session_id uuid primary key,
  ride_id uuid not null references krow_runtime.rides,
  actor_id uuid not null references public.users(uuid),
  device_id uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index one_tracking_device_per_ride on krow_runtime.location_sessions(ride_id) where revoked_at is null;
create table krow_runtime.devices (
  actor_id uuid not null references public.users(uuid),
  device_id uuid not null,
  platform text not null check (platform in ('android','ios')),
  token_encrypted text not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(actor_id,device_id)
);
create table krow_runtime.notification_intents (
  intent_id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references krow_runtime.rides,
  recipient_id uuid not null references public.users(uuid),
  event_key text not null,
  kind text not null check(kind in ('proximity','route_changed','cancelled','safety')),
  expires_at timestamptz not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique(recipient_id,event_key)
);
create table krow_runtime.delivery_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references krow_runtime.notification_intents,
  device_id uuid not null,
  channel text not null,
  status text not null check(status in ('pending','leased','accepted','failed','expired','received')),
  lease_until timestamptz,
  lease_owner uuid,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  provider_id text,
  error_code text,
  updated_at timestamptz not null default now(),
  unique(intent_id,device_id,channel)
);
create index notifications_pending on krow_runtime.notification_intents(expires_at) where acknowledged_at is null;
create index notifications_inbox on krow_runtime.notification_intents(recipient_id,created_at desc);
create index delivery_due on krow_runtime.delivery_attempts(next_attempt_at) where status in ('pending','leased','failed');
create table krow_runtime.safety_incidents (
  incident_id uuid primary key,
  ride_id uuid not null references krow_runtime.rides,
  reporter_id uuid not null references public.users(uuid),
  state text not null default 'open' check(state in ('open','acknowledged','responding','resolved')),
  severity text not null check(severity in ('urgent','critical')),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  escalation_level integer not null default 0,
  next_escalation_at timestamptz not null default now()
);
alter table krow_runtime.safety_incidents add column lease_owner uuid, add column lease_until timestamptz;
create index safety_escalation_due on krow_runtime.safety_incidents(next_escalation_at) where state='open';
create table krow_runtime.incident_audit (
  audit_id bigint generated always as identity primary key,
  incident_id uuid not null references krow_runtime.safety_incidents,
  actor_id uuid not null references public.users(uuid),
  previous_state text not null,
  state text not null,
  occurred_at timestamptz not null default now()
);
create table krow_runtime.traffic_events (
  provider text not null,
  provider_id text not null,
  ride_id uuid not null references krow_runtime.rides,
  kind text not null,
  state text not null check (state in ('active','resolved','expired')),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null,
  primary key(provider,provider_id,ride_id)
);

-- Legacy endpoints must not mutate an enrolled ride. Runtime transactions set this
-- local marker only after validating actor, version, state and locking the ride.
create or replace function krow_runtime.guard_legacy_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
  id := case when TG_OP='DELETE' then old.ride_id else new.ride_id end;
  if exists(select 1 from krow_runtime.rides r where r.ride_id=id)
    and coalesce(current_setting('krow.runtime_ride',true),'')<>id::text then
    raise exception using errcode='42501',message='Este viaje requiere la API v2';
  end if;
  if TG_OP='UPDATE' and old.ride_id is distinct from new.ride_id
    and exists(select 1 from krow_runtime.rides r where r.ride_id=old.ride_id) then
    raise exception using errcode='42501',message='No se puede reasignar una reserva';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function krow_runtime.guard_legacy_write() from public,anon,authenticated;
create trigger runtime_guard_ride before update or delete on public.rides for each row execute function krow_runtime.guard_legacy_write();
create trigger runtime_guard_booking before insert or update or delete on public.bookings for each row execute function krow_runtime.guard_legacy_write();
create trigger runtime_guard_stop before insert or update or delete on public.ride_stops for each row execute function krow_runtime.guard_legacy_write();

-- Private tables are server-only. Provision a dedicated backend login using the
-- deployment role script; never grant these policies to mobile/public API roles.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='krow_runtime' loop
    execute format('alter table krow_runtime.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema krow_runtime from public,anon,authenticated;
revoke all on all sequences in schema krow_runtime from public,anon,authenticated;
commit;
