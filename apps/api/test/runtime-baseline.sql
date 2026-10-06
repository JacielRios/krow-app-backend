-- Minimal structural fixture from the read-only remote audit. It deliberately
-- contains no production users, routes, credentials or provider content.
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create table public.users(uuid uuid primary key);
create table public.driver_profiles(driver_id uuid primary key,user_id uuid not null references public.users);
create table public.vehicles(vehicle_id uuid primary key,driver_id uuid references public.driver_profiles,capacity integer not null);
create table public.transport_stops(stop_id uuid primary key,active boolean not null default true);
create table public.rides(ride_id uuid primary key,driver_id uuid not null references public.driver_profiles,vehicle_id uuid references public.vehicles,
  status text not null default 'scheduled',available_seats integer not null,version integer default 1,
  route_polyline text,route_provider text,departure_time timestamptz default now()+interval '1 hour');
create table public.ride_stops(stop_id uuid primary key,ride_id uuid not null references public.rides,
  transport_stop_id uuid references public.transport_stops,stop_order integer not null,lat numeric not null,lng numeric not null,
  address text not null,is_active boolean not null default true,route_version integer default 1);
create table public.bookings(booking_id uuid primary key default gen_random_uuid(),ride_id uuid not null references public.rides,user_id uuid not null references public.users,
  pickup_stop_id uuid not null references public.ride_stops,dropoff_stop_id uuid not null references public.ride_stops,seats_reserved integer not null,
  status text not null constraint bookings_status_check check(status in ('pending','confirmed','rejected','cancelled','in_progress','completed')));
create table public.ride_status_history(id uuid default gen_random_uuid() primary key,ride_id uuid references public.rides,status text,previous_status text,actor_id uuid,reason text);
