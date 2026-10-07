-- Synthetic contract fixture only. NOT an audited production schema baseline.
-- Always loaded into an isolated in-memory database by pilot.integration.spec.
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.users(uuid uuid primary key references auth.users(id),full_name text,email_address text,profile_photo text,rating numeric,updated_at timestamptz default now(),is_active boolean default true,deleted_at timestamptz);
alter table public.users add column id bigint generated always as identity;
create table public.driver_profiles(driver_id uuid primary key,user_id uuid references public.users(uuid),status text default 'approved',rating numeric);
create table public.vehicles(vehicle_id uuid primary key,driver_id uuid references public.driver_profiles(driver_id),brand text,model text,license_plate text,capacity integer);
alter table public.vehicles add column car_color text;
alter table public.vehicles add column is_active boolean not null default true;
create table public.rides(ride_id uuid primary key,driver_id uuid references public.driver_profiles(driver_id),vehicle_id uuid references public.vehicles(vehicle_id),status text default 'scheduled',origin_lat double precision default 25.67,origin_lng double precision default -100.3,destination_lat double precision default 25.68,destination_lng double precision default -100.31,origin_address text default 'Campus',destination_address text default 'Destino sintético',route_polyline text default 'published',price_per_seat numeric default 12.34,available_seats integer default 3,version integer default 1,updated_at timestamptz default now(),departure_time timestamptz default now(),created_at timestamptz default now());
create table public.ride_stops(stop_id uuid primary key,ride_id uuid references public.rides(ride_id),stop_order integer,lat double precision,lng double precision,address text);
create table public.bookings(booking_id uuid primary key,ride_id uuid references public.rides(ride_id),user_id uuid references public.users(uuid),pickup_stop_id uuid references public.ride_stops(stop_id),dropoff_stop_id uuid references public.ride_stops(stop_id),status text default 'pending',constraint bookings_status_check check(status in('pending','confirmed','in_progress','completed','rejected','cancelled')),seats_reserved integer default 1,created_at timestamptz default now());
create table public.ride_status_history(id uuid primary key default gen_random_uuid(),ride_id uuid references public.rides(ride_id),status text,previous_status text,actor_id uuid references auth.users(id),reason text);
-- These stubs validate the private execution grant and auth.uid preservation;
-- they do not replace the production geometry RPC implementations.
create function public.create_ride_v2(jsonb) returns uuid language sql security definer set search_path=public as $$ select auth.uid() $$;
create function public.update_ride_v2(uuid,integer,jsonb) returns integer language sql as $$ select 2 $$;
create function public.upsert_favorite_route(jsonb) returns uuid language sql security definer set search_path=public as $$ select auth.uid() $$;
create function public.request_booking_v2(jsonb) returns uuid language sql security definer set search_path=public as $$ select auth.uid() $$;
create function public.delete_favorite_route(uuid) returns void language plpgsql security definer set search_path=public as $$ begin return; end; $$;
grant execute on all functions in schema public to authenticated;

create table public.ride_reviews(review_id uuid primary key default gen_random_uuid(),ride_id uuid references public.rides(ride_id),reviewer_id uuid references public.users(uuid),reviewee_id uuid references public.users(uuid),rating smallint check(rating between 1 and 5),comment text,created_at timestamptz default now(),unique(ride_id,reviewer_id,reviewee_id));
create function public.update_user_rating_on_review() returns trigger language plpgsql security definer set search_path=public as $$ begin update public.users set rating=(select avg(rating)::numeric(3,2) from public.ride_reviews where reviewee_id=new.reviewee_id),updated_at=now() where uuid=new.reviewee_id; update public.driver_profiles set rating=(select avg(rating)::numeric(3,2) from public.ride_reviews where reviewee_id=new.reviewee_id) where user_id=new.reviewee_id; return new; end; $$;
create trigger review_rating after insert on public.ride_reviews for each row execute function public.update_user_rating_on_review();

create table public.transport_stops(stop_id uuid primary key,active boolean default true);
alter table public.rides add column route_provider text;
alter table public.ride_stops add column transport_stop_id uuid,add column route_version integer default 1,add column is_active boolean default true;
alter table public.users add column institutional_id text,add column academic_program text,add column academic_period integer;
create unique index fixture_institutional_id_unique on public.users(institutional_id);
create unique index bookings_one_active_per_user_ride on public.bookings(ride_id,user_id) where status <> 'cancelled';
grant usage on schema auth to authenticated;
grant select on public.users to authenticated;
-- Match the inherited excessive grants discovered in the metadata audit. The
-- privacy migration must remove these; RLS alone does not protect TRUNCATE.
grant truncate,references,trigger on public.users,public.bookings to anon,authenticated;
alter table public.users enable row level security;
create policy fixture_user_select on public.users for select to authenticated using(auth.uid()=uuid);
create policy fixture_user_insert on public.users for insert to authenticated with check(auth.uid()=uuid);
create policy fixture_user_update on public.users for update to authenticated using(auth.uid()=uuid) with check(auth.uid()=uuid);
