-- Synthetic fixture only. PostGIS geometry is replaced here by a catalog-only
-- selection seam; production geometry is independently checked on live PostGIS.
create role anon;
create role authenticated;
create role krow_pilot_service;
create schema auth;
create schema private;
grant usage on schema public,auth,private to authenticated,krow_pilot_service;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.users(uuid uuid primary key,full_name text,is_active boolean default true,deleted_at timestamptz);
create table public.driver_profiles(driver_id uuid primary key,user_id uuid,status text default 'approved',rating numeric);
create table public.vehicles(vehicle_id uuid primary key,driver_id uuid,brand text,model text,license_plate text,car_color text,capacity integer,is_active boolean default true);
create table public.transport_stops(stop_id uuid primary key default gen_random_uuid(),external_id text unique,name text,address text,municipality text,latitude double precision,longitude double precision,stop_type text default 'general',source text,active boolean default true,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.favorite_routes(route_id uuid primary key default gen_random_uuid(),driver_id uuid,name text,origin_place_id text,origin_address text,origin_lat double precision,origin_lng double precision,destination_place_id text,destination_address text,destination_lat double precision,destination_lng double precision,default_vehicle_id uuid,default_available_seats integer,default_price_per_seat numeric,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.favorite_route_stops(route_id uuid,transport_stop_id uuid,stop_order integer,route_fraction double precision,primary key(route_id,stop_order));
create table public.rides(ride_id uuid primary key default gen_random_uuid(),driver_id uuid,vehicle_id uuid,favorite_route_id uuid,version integer default 1,origin_lat numeric,origin_lng numeric,destination_lat numeric,destination_lng numeric,origin_address text,destination_address text,route_polyline text,route_distance_meters integer,route_duration_seconds integer,route_provider text,route_calculated_at timestamptz,departure_time timestamptz,available_seats integer,price_per_seat numeric,status text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.ride_stops(stop_id uuid primary key default gen_random_uuid(),ride_id uuid,transport_stop_id uuid,stop_order integer,lat numeric,lng numeric,address text,route_fraction double precision,is_active boolean default true,route_version integer default 1);
create table public.bookings(booking_id uuid primary key default gen_random_uuid(),ride_id uuid,user_id uuid,pickup_stop_id uuid,dropoff_stop_id uuid,seats_reserved integer default 1,status text,created_at timestamptz default now());
create table public.ride_status_history(id uuid primary key default gen_random_uuid(),ride_id uuid,status text,previous_status text,actor_id uuid,reason text);
create function private.route_stop_selection(p_route_geojson jsonb,p_stop_ids uuid[],p_corridor_m integer default 500)
returns table(stop_id uuid,stop_order integer,route_fraction double precision) language sql stable set search_path='' as $$
 select s.stop_id,row_number() over(order by case when s.external_id='krow-initial-stop-2' then 0 else 1 end,s.longitude,s.latitude,s.stop_id)::integer,
 case when s.external_id='krow-initial-stop-2' then 0.0 else 0.5 end::double precision
 from public.transport_stops s where s.active and s.stop_id=any(p_stop_ids)
$$;
