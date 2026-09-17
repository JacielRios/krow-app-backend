-- Fuente versionada para la evolución de rutas. Revisar contra el esquema remoto
-- con `supabase db diff` antes de aplicar por primera vez.
create extension if not exists postgis;
create extension if not exists pgcrypto;

alter table public.rides
  add column if not exists route_distance_meters integer,
  add column if not exists route_duration_seconds integer,
  add column if not exists route_provider text,
  add column if not exists route_calculated_at timestamptz,
  add column if not exists route_version integer not null default 1,
  add column if not exists origin_geography geography(point, 4326),
  add column if not exists destination_geography geography(point, 4326),
  add column if not exists route_geography geography(linestring, 4326);

alter table public.bookings
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists pickup_address text,
  add column if not exists dropoff_lat double precision,
  add column if not exists dropoff_lng double precision,
  add column if not exists dropoff_address text,
  add column if not exists route_version integer;

create table if not exists public.ride_route_versions (
  route_version_id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(ride_id) on delete cascade,
  version integer not null,
  encoded_polyline text not null,
  route_geography geography(linestring, 4326),
  distance_meters integer not null,
  duration_seconds integer not null,
  provider text not null,
  calculated_at timestamptz not null default now(),
  unique (ride_id, version)
);

create index if not exists rides_origin_geography_gix on public.rides using gist (origin_geography);
create index if not exists rides_destination_geography_gix on public.rides using gist (destination_geography);
create index if not exists rides_route_geography_gix on public.rides using gist (route_geography);
create index if not exists rides_search_idx on public.rides (status, departure_time);
create index if not exists bookings_ride_status_idx on public.bookings (ride_id, status);
