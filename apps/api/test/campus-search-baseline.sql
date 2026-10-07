-- Isolated synthetic fixture, never applied to production.
-- PGlite has no PostGIS. These point-only geography functions exercise the real
-- SQL joins, ordering, authorization and distance thresholds with a spherical
-- distance kernel; live PostGIS validation remains a deployment check.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create schema extensions;
create domain extensions.geography as double precision[];
create function extensions.st_makepoint(double precision,double precision)
returns double precision[] language sql immutable as $$ select array[$1,$2] $$;
create function extensions.st_setsrid(double precision[],integer)
returns double precision[] language sql immutable as $$ select $1 $$;
create function extensions.st_distance(extensions.geography,extensions.geography)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1.0,sqrt(
    power(sin(radians(($2[2]-$1[2])/2)),2)
    + cos(radians($1[2])) * cos(radians($2[2]))
    * power(sin(radians(($2[1]-$1[1])/2)),2)
  )))
$$;
create function extensions.st_dwithin(extensions.geography,extensions.geography,double precision)
returns boolean language sql immutable as $$
  select extensions.st_distance($1,$2) <= $3
$$;
create table public.users(uuid uuid primary key,full_name text);
create table public.driver_profiles(driver_id uuid primary key,user_id uuid,rating numeric);
create table public.vehicles(
  vehicle_id uuid primary key,brand text,model text,license_plate text,
  car_color text,capacity integer
);
create table public.rides(
  ride_id uuid primary key,driver_id uuid,vehicle_id uuid,version integer default 1,
  origin_lat numeric,origin_lng numeric,destination_lat numeric,destination_lng numeric,
  origin_address text,destination_address text,route_polyline text,
  route_distance_meters integer,route_duration_seconds integer,
  departure_time timestamptz,available_seats integer,price_per_seat numeric,status text
);
create table public.transport_stops(
  stop_id uuid primary key,external_id text,name text,address text,municipality text,
  stop_type text,latitude double precision,longitude double precision,
  location extensions.geography,active boolean default true
);
create table public.ride_stops(
  stop_id uuid primary key,ride_id uuid,transport_stop_id uuid,stop_order integer,
  lat numeric,lng numeric,address text,location extensions.geography,
  is_active boolean default true,route_version integer default 1
);
grant usage on schema public,auth to authenticated,anon,service_role;
