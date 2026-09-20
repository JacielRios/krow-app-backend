-- Driver routes, reusable favorites, curated transit stops and explicit
-- passenger pickup/dropoff selection. Legacy ride stops remain addressable.

create extension if not exists postgis with schema extensions;

create table public.transport_stops (
  stop_id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  name text not null,
  address text,
  municipality text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(
      extensions.st_makepoint(longitude, latitude), 4326
    )::extensions.geography
  ) stored,
  source text not null default 'krow_curated',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_stops_external_id_not_blank check (length(btrim(external_id)) > 0),
  constraint transport_stops_name_not_blank check (length(btrim(name)) > 0)
);

create table public.favorite_routes (
  route_id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles(driver_id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  origin_place_id text,
  origin_address text not null,
  origin_lat double precision not null check (origin_lat between -90 and 90),
  origin_lng double precision not null check (origin_lng between -180 and 180),
  destination_place_id text,
  destination_address text not null,
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  default_vehicle_id uuid references public.vehicles(vehicle_id) on delete set null,
  default_available_seats integer check (default_available_seats is null or default_available_seats >= 1),
  default_price_per_seat numeric(10, 2) check (default_price_per_seat is null or default_price_per_seat > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index favorite_routes_driver_name_uidx
  on public.favorite_routes (driver_id, lower(name));

create table public.favorite_route_stops (
  route_id uuid not null references public.favorite_routes(route_id) on delete cascade,
  transport_stop_id uuid not null references public.transport_stops(stop_id) on delete restrict,
  stop_order integer not null check (stop_order >= 1),
  route_fraction double precision not null check (route_fraction between 0 and 1),
  primary key (route_id, stop_order),
  unique (route_id, transport_stop_id)
);

alter table public.rides
  add column favorite_route_id uuid references public.favorite_routes(route_id) on delete set null,
  add column route_distance_meters integer check (route_distance_meters is null or route_distance_meters >= 0),
  add column route_duration_seconds integer check (route_duration_seconds is null or route_duration_seconds >= 0),
  add column route_provider text,
  add column route_calculated_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add column version integer not null default 1 check (version >= 1);

alter table public.ride_stops
  add column transport_stop_id uuid references public.transport_stops(stop_id) on delete restrict,
  add column route_version integer not null default 1 check (route_version >= 1),
  add column is_active boolean not null default true,
  add column route_fraction double precision check (route_fraction is null or route_fraction between 0 and 1),
  add column location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(
      extensions.st_makepoint(lng::double precision, lat::double precision), 4326
    )::extensions.geography
  ) stored;

alter table public.ride_stops drop constraint ride_stops_ride_id_stop_order_key;
alter table public.ride_stops add constraint ride_stops_ride_version_order_key
  unique (ride_id, route_version, stop_order);

create unique index ride_stops_current_catalog_stop_uidx
  on public.ride_stops (ride_id, transport_stop_id)
  where is_active and transport_stop_id is not null;
create index transport_stops_location_gix on public.transport_stops using gist (location);
create index transport_stops_active_idx on public.transport_stops (active, external_id);
create index favorite_routes_driver_id_idx on public.favorite_routes (driver_id, updated_at desc);
create index favorite_routes_default_vehicle_id_idx on public.favorite_routes (default_vehicle_id)
  where default_vehicle_id is not null;
create index favorite_route_stops_stop_id_idx on public.favorite_route_stops (transport_stop_id);
create index rides_vehicle_id_idx on public.rides (vehicle_id);
create index rides_favorite_route_id_idx on public.rides (favorite_route_id)
  where favorite_route_id is not null;
create index rides_driver_upcoming_idx on public.rides (driver_id, departure_time)
  where status in ('scheduled', 'full', 'in_progress');
create index rides_search_status_departure_idx on public.rides (status, departure_time);
create index ride_stops_location_gix on public.ride_stops using gist (location);
create index ride_stops_current_ride_order_idx on public.ride_stops (ride_id, stop_order)
  where is_active;
create index ride_stops_transport_stop_id_idx on public.ride_stops (transport_stop_id)
  where transport_stop_id is not null;
create index bookings_pickup_stop_id_idx on public.bookings (pickup_stop_id);
create index bookings_dropoff_stop_id_idx on public.bookings (dropoff_stop_id);
create index bookings_ride_status_idx on public.bookings (ride_id, status);
create index ride_status_history_ride_id_idx on public.ride_status_history (ride_id, changed_at desc);

alter table public.transport_stops enable row level security;
alter table public.favorite_routes enable row level security;
alter table public.favorite_route_stops enable row level security;

create policy transport_stops_authenticated_read on public.transport_stops
  for select to authenticated using ((select auth.uid()) is not null);
create policy favorite_routes_owner_read on public.favorite_routes
  for select to authenticated using (
    exists (
      select 1 from public.driver_profiles dp
      where dp.driver_id = favorite_routes.driver_id
        and dp.user_id = (select auth.uid())
    )
  );
create policy favorite_route_stops_owner_read on public.favorite_route_stops
  for select to authenticated using (
    exists (
      select 1
      from public.favorite_routes fr
      join public.driver_profiles dp on dp.driver_id = fr.driver_id
      where fr.route_id = favorite_route_stops.route_id
        and dp.user_id = (select auth.uid())
    )
  );

revoke all on public.transport_stops, public.favorite_routes, public.favorite_route_stops from anon;
grant select on public.transport_stops, public.favorite_routes, public.favorite_route_stops to authenticated;

create or replace function private.route_stop_selection(
  p_route_geojson jsonb, p_stop_ids uuid[], p_corridor_m integer default 500
)
returns table (stop_id uuid, stop_order integer, route_fraction double precision)
language sql stable set search_path = '' as $$
  with route as (
    select extensions.st_setsrid(
      extensions.st_geomfromgeojson(p_route_geojson::text), 4326
    ) as geom
  ), ranked as (
    select ts.stop_id,
      extensions.st_linelocatepoint(route.geom, ts.location::extensions.geometry) as route_fraction
    from public.transport_stops ts cross join route
    where ts.active and ts.stop_id = any(p_stop_ids)
      and extensions.st_dwithin(ts.location, route.geom::extensions.geography, p_corridor_m)
  )
  select ranked.stop_id,
    row_number() over (order by ranked.route_fraction, ranked.stop_id)::integer,
    ranked.route_fraction
  from ranked order by ranked.route_fraction, ranked.stop_id;
$$;
revoke all on function private.route_stop_selection(jsonb, uuid[], integer)
  from public, anon, authenticated;

create or replace function public.find_compatible_transport_stops(
  p_route_geojson jsonb, p_corridor_m integer default 500
)
returns table (
  stop_id uuid, external_id text, name text, address text, municipality text,
  lat double precision, lng double precision,
  distance_from_route_m double precision, route_fraction double precision
)
language plpgsql stable set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_route extensions.geometry;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_corridor_m < 1 or p_corridor_m > 5000 then
    raise exception 'El corredor solicitado no es valido';
  end if;
  v_route := extensions.st_setsrid(
    extensions.st_geomfromgeojson(p_route_geojson::text), 4326
  );
  if extensions.st_geometrytype(v_route) <> 'ST_LineString' then
    raise exception 'La geometria de ruta debe ser LineString';
  end if;
  return query
  select ts.stop_id, ts.external_id, ts.name, ts.address, ts.municipality,
    ts.latitude, ts.longitude,
    extensions.st_distance(ts.location, v_route::extensions.geography),
    extensions.st_linelocatepoint(v_route, ts.location::extensions.geometry)
  from public.transport_stops ts
  where ts.active
    and extensions.st_dwithin(ts.location, v_route::extensions.geography, p_corridor_m)
  order by extensions.st_linelocatepoint(v_route, ts.location::extensions.geometry), ts.name;
end;
$$;

create or replace function public.upsert_favorite_route(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_driver_id uuid;
  v_route_id uuid;
  v_stop_ids uuid[];
  v_selected_count integer;
  v_default_vehicle_id uuid;
  v_default_capacity integer;
  v_default_seats integer;
  v_default_price numeric;
  v_route_name text;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  select dp.driver_id into v_driver_id
  from public.driver_profiles dp
  where dp.user_id = v_actor and dp.status = 'approved';
  if v_driver_id is null then
    raise exception 'Se requiere un perfil de conductor aprobado';
  end if;

  v_route_name := btrim(coalesce(p_payload->>'name', ''));
  if length(v_route_name) < 1 or length(v_route_name) > 80 then
    raise exception 'El nombre de la ruta no es valido';
  end if;
  select coalesce(array_agg(item.value::uuid order by item.ordinality), '{}'::uuid[])
    into v_stop_ids
  from jsonb_array_elements_text(
    coalesce(p_payload->'transport_stop_ids', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);
  if cardinality(v_stop_ids) < 2 then
    raise exception 'Selecciona al menos dos paradas';
  end if;
  if cardinality(v_stop_ids) <> (
    select count(distinct selected_id) from unnest(v_stop_ids) as selected_id
  ) then
    raise exception 'Las paradas no pueden repetirse';
  end if;
  select count(*) into v_selected_count
  from private.route_stop_selection(p_payload->'route_geojson', v_stop_ids, 500);
  if v_selected_count <> cardinality(v_stop_ids) then
    raise exception 'Una o mas paradas no pertenecen al corredor de la ruta';
  end if;

  v_default_vehicle_id := nullif(p_payload->>'default_vehicle_id', '')::uuid;
  v_default_seats := nullif(p_payload->>'default_available_seats', '')::integer;
  v_default_price := nullif(p_payload->>'default_price_per_seat', '')::numeric;
  if v_default_vehicle_id is not null then
    select v.capacity into v_default_capacity
    from public.vehicles v
    where v.vehicle_id = v_default_vehicle_id
      and v.driver_id = v_driver_id and v.is_active;
    if v_default_capacity is null then
      raise exception 'El vehiculo predeterminado no es valido';
    end if;
    if v_default_seats is not null
       and v_default_seats > greatest(v_default_capacity - 1, 0) then
      raise exception 'Los asientos exceden la capacidad del vehiculo';
    end if;
  end if;
  if v_default_seats is not null and v_default_seats < 1 then
    raise exception 'La cantidad predeterminada de asientos no es valida';
  end if;
  if v_default_price is not null and v_default_price <= 0 then
    raise exception 'El precio predeterminado debe ser mayor que cero';
  end if;

  v_route_id := nullif(p_payload->>'route_id', '')::uuid;
  if v_route_id is null then
    insert into public.favorite_routes (
      driver_id, name, origin_place_id, origin_address, origin_lat, origin_lng,
      destination_place_id, destination_address, destination_lat, destination_lng,
      default_vehicle_id, default_available_seats, default_price_per_seat
    ) values (
      v_driver_id, v_route_name,
      nullif(p_payload->>'origin_place_id', ''), p_payload->>'origin_address',
      (p_payload->>'origin_lat')::double precision,
      (p_payload->>'origin_lng')::double precision,
      nullif(p_payload->>'destination_place_id', ''), p_payload->>'destination_address',
      (p_payload->>'destination_lat')::double precision,
      (p_payload->>'destination_lng')::double precision,
      v_default_vehicle_id, v_default_seats, v_default_price
    ) returning route_id into v_route_id;
  else
    perform 1 from public.favorite_routes fr
    where fr.route_id = v_route_id and fr.driver_id = v_driver_id for update;
    if not found then raise exception 'Ruta favorita no encontrada'; end if;
    update public.favorite_routes
    set name = v_route_name,
        origin_place_id = nullif(p_payload->>'origin_place_id', ''),
        origin_address = p_payload->>'origin_address',
        origin_lat = (p_payload->>'origin_lat')::double precision,
        origin_lng = (p_payload->>'origin_lng')::double precision,
        destination_place_id = nullif(p_payload->>'destination_place_id', ''),
        destination_address = p_payload->>'destination_address',
        destination_lat = (p_payload->>'destination_lat')::double precision,
        destination_lng = (p_payload->>'destination_lng')::double precision,
        default_vehicle_id = v_default_vehicle_id,
        default_available_seats = v_default_seats,
        default_price_per_seat = v_default_price,
        updated_at = now()
    where route_id = v_route_id;
    delete from public.favorite_route_stops where route_id = v_route_id;
  end if;
  insert into public.favorite_route_stops (
    route_id, transport_stop_id, stop_order, route_fraction
  )
  select v_route_id, selection.stop_id, selection.stop_order, selection.route_fraction
  from private.route_stop_selection(
    p_payload->'route_geojson', v_stop_ids, 500
  ) selection;
  return v_route_id;
end;
$$;

create or replace function public.delete_favorite_route(p_route_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  delete from public.favorite_routes fr
  using public.driver_profiles dp
  where fr.route_id = p_route_id
    and dp.driver_id = fr.driver_id and dp.user_id = v_actor;
  if not found then raise exception 'Ruta favorita no encontrada'; end if;
end;
$$;

create or replace function public.create_ride_v2(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_vehicle_capacity integer;
  v_favorite_route_id uuid;
  v_ride_id uuid;
  v_stop_ids uuid[];
  v_selected_count integer;
  v_available_seats integer;
  v_price numeric;
  v_departure timestamptz;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  select dp.driver_id into v_driver_id
  from public.driver_profiles dp
  where dp.user_id = v_actor and dp.status = 'approved';
  if v_driver_id is null then
    raise exception 'Se requiere un perfil de conductor aprobado';
  end if;
  v_vehicle_id := (p_payload->>'vehicle_id')::uuid;
  select v.capacity into v_vehicle_capacity
  from public.vehicles v
  where v.vehicle_id = v_vehicle_id
    and v.driver_id = v_driver_id and v.is_active;
  if v_vehicle_capacity is null then raise exception 'Vehiculo no valido'; end if;
  v_available_seats := (p_payload->>'available_seats')::integer;
  if v_available_seats < 1
     or v_available_seats > greatest(v_vehicle_capacity - 1, 0) then
    raise exception 'Los asientos exceden la capacidad disponible';
  end if;
  v_price := (p_payload->>'price_per_seat')::numeric;
  if v_price <= 0 then raise exception 'El precio debe ser mayor que cero'; end if;
  v_departure := (p_payload->>'departure_time')::timestamptz;
  if v_departure < now() + interval '15 minutes' then
    raise exception 'La salida debe programarse con al menos 15 minutos';
  end if;

  v_favorite_route_id := nullif(p_payload->>'favorite_route_id', '')::uuid;
  if v_favorite_route_id is not null and not exists (
    select 1 from public.favorite_routes fr
    where fr.route_id = v_favorite_route_id and fr.driver_id = v_driver_id
  ) then
    raise exception 'Ruta favorita no valida';
  end if;
  select coalesce(array_agg(item.value::uuid order by item.ordinality), '{}'::uuid[])
    into v_stop_ids
  from jsonb_array_elements_text(
    coalesce(p_payload->'transport_stop_ids', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);
  if cardinality(v_stop_ids) < 2 then raise exception 'Selecciona al menos dos paradas'; end if;
  if cardinality(v_stop_ids) <> (
    select count(distinct selected_id) from unnest(v_stop_ids) as selected_id
  ) then raise exception 'Las paradas no pueden repetirse'; end if;
  select count(*) into v_selected_count
  from private.route_stop_selection(p_payload->'route_geojson', v_stop_ids, 500);
  if v_selected_count <> cardinality(v_stop_ids) then
    raise exception 'Una o mas paradas no pertenecen al corredor de la ruta';
  end if;

  insert into public.rides (
    driver_id, vehicle_id, favorite_route_id,
    origin_lat, origin_lng, destination_lat, destination_lng,
    origin_address, destination_address, route_polyline,
    route_distance_meters, route_duration_seconds, route_provider,
    route_calculated_at, departure_time, available_seats,
    price_per_seat, status
  ) values (
    v_driver_id, v_vehicle_id, v_favorite_route_id,
    (p_payload->>'origin_lat')::numeric, (p_payload->>'origin_lng')::numeric,
    (p_payload->>'destination_lat')::numeric,
    (p_payload->>'destination_lng')::numeric,
    nullif(p_payload->>'origin_address', ''),
    nullif(p_payload->>'destination_address', ''),
    p_payload->>'route_polyline',
    (p_payload->>'route_distance_meters')::integer,
    (p_payload->>'route_duration_seconds')::integer,
    coalesce(nullif(p_payload->>'route_provider', ''), 'google'),
    coalesce((p_payload->>'route_calculated_at')::timestamptz, now()),
    v_departure, v_available_seats, v_price, 'scheduled'
  ) returning ride_id into v_ride_id;
  insert into public.ride_stops (
    ride_id, transport_stop_id, lat, lng, address,
    stop_order, route_version, is_active, route_fraction
  )
  select v_ride_id, ts.stop_id, ts.latitude, ts.longitude,
    coalesce(nullif(ts.address, ''), ts.name),
    selection.stop_order, 1, true, selection.route_fraction
  from private.route_stop_selection(
    p_payload->'route_geojson', v_stop_ids, 500
  ) selection
  join public.transport_stops ts on ts.stop_id = selection.stop_id;
  insert into public.ride_status_history (
    ride_id, status, previous_status, actor_id, reason
  ) values (
    v_ride_id, 'scheduled', null, v_actor, 'ride_created_with_catalog_stops'
  );
  return v_ride_id;
end;
$$;

create or replace function public.update_ride_v2(
  p_ride_id uuid, p_expected_version integer, p_payload jsonb
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_driver_id uuid;
  v_ride public.rides%rowtype;
  v_vehicle_id uuid;
  v_vehicle_capacity integer;
  v_favorite_route_id uuid;
  v_stop_ids uuid[];
  v_selected_count integer;
  v_available_seats integer;
  v_price numeric;
  v_departure timestamptz;
  v_new_version integer;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  select dp.driver_id into v_driver_id
  from public.driver_profiles dp
  where dp.user_id = v_actor and dp.status = 'approved';
  if v_driver_id is null then
    raise exception 'Se requiere un perfil de conductor aprobado';
  end if;
  select * into v_ride from public.rides r
  where r.ride_id = p_ride_id for update;
  if not found or v_ride.driver_id <> v_driver_id then
    raise exception 'Viaje no encontrado';
  end if;
  if v_ride.status <> 'scheduled' then
    raise exception 'El viaje ya no se puede editar';
  end if;
  if v_ride.version <> p_expected_version then
    raise exception 'Conflicto de version del viaje';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.ride_id = p_ride_id
      and b.status in ('pending', 'confirmed', 'in_progress')
  ) then
    raise exception 'El viaje tiene reservas activas y no se puede editar';
  end if;

  v_vehicle_id := (p_payload->>'vehicle_id')::uuid;
  select v.capacity into v_vehicle_capacity
  from public.vehicles v
  where v.vehicle_id = v_vehicle_id
    and v.driver_id = v_driver_id and v.is_active;
  if v_vehicle_capacity is null then raise exception 'Vehiculo no valido'; end if;
  v_available_seats := (p_payload->>'available_seats')::integer;
  if v_available_seats < 1
     or v_available_seats > greatest(v_vehicle_capacity - 1, 0) then
    raise exception 'Los asientos exceden la capacidad disponible';
  end if;
  v_price := (p_payload->>'price_per_seat')::numeric;
  if v_price <= 0 then raise exception 'El precio debe ser mayor que cero'; end if;
  v_departure := (p_payload->>'departure_time')::timestamptz;
  if v_departure < now() + interval '15 minutes' then
    raise exception 'La salida debe programarse con al menos 15 minutos';
  end if;
  v_favorite_route_id := nullif(p_payload->>'favorite_route_id', '')::uuid;
  if v_favorite_route_id is not null and not exists (
    select 1 from public.favorite_routes fr
    where fr.route_id = v_favorite_route_id and fr.driver_id = v_driver_id
  ) then
    raise exception 'Ruta favorita no valida';
  end if;

  select coalesce(array_agg(item.value::uuid order by item.ordinality), '{}'::uuid[])
    into v_stop_ids
  from jsonb_array_elements_text(
    coalesce(p_payload->'transport_stop_ids', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);
  if cardinality(v_stop_ids) < 2 then raise exception 'Selecciona al menos dos paradas'; end if;
  if cardinality(v_stop_ids) <> (
    select count(distinct selected_id) from unnest(v_stop_ids) as selected_id
  ) then raise exception 'Las paradas no pueden repetirse'; end if;
  select count(*) into v_selected_count
  from private.route_stop_selection(p_payload->'route_geojson', v_stop_ids, 500);
  if v_selected_count <> cardinality(v_stop_ids) then
    raise exception 'Una o mas paradas no pertenecen al corredor de la ruta';
  end if;

  v_new_version := v_ride.version + 1;
  update public.ride_stops set is_active = false
  where ride_id = p_ride_id and is_active;
  update public.rides
  set vehicle_id = v_vehicle_id,
      favorite_route_id = v_favorite_route_id,
      origin_lat = (p_payload->>'origin_lat')::numeric,
      origin_lng = (p_payload->>'origin_lng')::numeric,
      destination_lat = (p_payload->>'destination_lat')::numeric,
      destination_lng = (p_payload->>'destination_lng')::numeric,
      origin_address = nullif(p_payload->>'origin_address', ''),
      destination_address = nullif(p_payload->>'destination_address', ''),
      route_polyline = p_payload->>'route_polyline',
      route_distance_meters = (p_payload->>'route_distance_meters')::integer,
      route_duration_seconds = (p_payload->>'route_duration_seconds')::integer,
      route_provider = coalesce(nullif(p_payload->>'route_provider', ''), 'google'),
      route_calculated_at = coalesce(
        (p_payload->>'route_calculated_at')::timestamptz, now()
      ),
      departure_time = v_departure,
      available_seats = v_available_seats,
      price_per_seat = v_price,
      updated_at = now(),
      version = v_new_version
  where ride_id = p_ride_id;
  insert into public.ride_stops (
    ride_id, transport_stop_id, lat, lng, address,
    stop_order, route_version, is_active, route_fraction
  )
  select p_ride_id, ts.stop_id, ts.latitude, ts.longitude,
    coalesce(nullif(ts.address, ''), ts.name),
    selection.stop_order, v_new_version, true, selection.route_fraction
  from private.route_stop_selection(
    p_payload->'route_geojson', v_stop_ids, 500
  ) selection
  join public.transport_stops ts on ts.stop_id = selection.stop_id;
  insert into public.ride_status_history (
    ride_id, status, previous_status, actor_id, reason
  ) values (
    p_ride_id, 'scheduled', 'scheduled', v_actor, 'ride_updated_by_driver'
  );
  return v_new_version;
end;
$$;

create or replace function public.search_available_rides_v2(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_max_results integer default 50,
  p_from_time timestamptz default null,
  p_to_time timestamptz default null,
  p_max_distance_m integer default 500
)
returns table (
  ride_id uuid, driver_id uuid, driver_name text, driver_rating numeric,
  vehicle_id uuid, vehicle_brand text, vehicle_model text,
  vehicle_plate text, vehicle_color text, vehicle_capacity integer,
  origin_lat numeric, origin_lng numeric,
  destination_lat numeric, destination_lng numeric,
  origin_address text, destination_address text, route_polyline text,
  route_distance_meters integer, route_duration_seconds integer,
  departure_time timestamptz, available_seats integer,
  price_per_seat numeric, status text,
  pickup_stop_id uuid, pickup_stop_name text, pickup_stop_address text,
  pickup_stop_lat numeric, pickup_stop_lng numeric,
  pickup_distance_m double precision,
  dropoff_stop_id uuid, dropoff_stop_name text, dropoff_stop_address text,
  dropoff_stop_lat numeric, dropoff_stop_lng numeric,
  dropoff_distance_m double precision
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_max_results < 1 or p_max_results > 100 then
    raise exception 'Limite de resultados no valido';
  end if;
  if p_max_distance_m < 1 or p_max_distance_m > 5000 then
    raise exception 'Distancia maxima no valida';
  end if;
  v_origin := extensions.st_setsrid(
    extensions.st_makepoint(p_origin_lng, p_origin_lat), 4326
  )::extensions.geography;
  v_destination := extensions.st_setsrid(
    extensions.st_makepoint(p_destination_lng, p_destination_lat), 4326
  )::extensions.geography;
  return query
  select
    r.ride_id, r.driver_id, u.full_name, dp.rating,
    v.vehicle_id, v.brand, v.model, v.license_plate, v.car_color, v.capacity,
    r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng,
    r.origin_address, r.destination_address, r.route_polyline,
    r.route_distance_meters, r.route_duration_seconds,
    r.departure_time, r.available_seats, r.price_per_seat, r.status,
    pair.pickup_stop_id, pair.pickup_name, pair.pickup_address,
    pair.pickup_lat, pair.pickup_lng, pair.pickup_distance_m,
    pair.dropoff_stop_id, pair.dropoff_name, pair.dropoff_address,
    pair.dropoff_lat, pair.dropoff_lng, pair.dropoff_distance_m
  from public.rides r
  join public.driver_profiles dp on dp.driver_id = r.driver_id
  join public.users u on u.uuid = dp.user_id
  join public.vehicles v on v.vehicle_id = r.vehicle_id
  join lateral (
    select
      ps.stop_id as pickup_stop_id,
      pts.name as pickup_name,
      ps.address as pickup_address,
      ps.lat as pickup_lat,
      ps.lng as pickup_lng,
      extensions.st_distance(ps.location, v_origin) as pickup_distance_m,
      ds.stop_id as dropoff_stop_id,
      dts.name as dropoff_name,
      ds.address as dropoff_address,
      ds.lat as dropoff_lat,
      ds.lng as dropoff_lng,
      extensions.st_distance(ds.location, v_destination) as dropoff_distance_m
    from public.ride_stops ps
    join public.transport_stops pts on pts.stop_id = ps.transport_stop_id
    join public.ride_stops ds
      on ds.ride_id = ps.ride_id and ds.is_active
     and ds.stop_order > ps.stop_order
    join public.transport_stops dts on dts.stop_id = ds.transport_stop_id
    where ps.ride_id = r.ride_id and ps.is_active
      and ps.route_version = r.version and ds.route_version = r.version
      and extensions.st_dwithin(ps.location, v_origin, p_max_distance_m)
      and extensions.st_dwithin(ds.location, v_destination, p_max_distance_m)
    order by
      extensions.st_distance(ps.location, v_origin)
      + extensions.st_distance(ds.location, v_destination),
      ps.stop_order, ds.stop_order
    limit 1
  ) pair on true
  where r.status = 'scheduled' and r.available_seats > 0
    and r.departure_time >= coalesce(p_from_time, now())
    and (p_to_time is null or r.departure_time <= p_to_time)
    and dp.user_id <> v_actor
  order by r.departure_time
  limit p_max_results;
end;
$$;

create or replace function public.get_ride_stop_options(
  p_ride_id uuid,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_max_distance_m integer default 500
)
returns table (
  pickup_stop_id uuid, pickup_stop_name text, pickup_stop_address text,
  pickup_stop_lat numeric, pickup_stop_lng numeric,
  pickup_distance_m double precision,
  dropoff_stop_id uuid, dropoff_stop_name text, dropoff_stop_address text,
  dropoff_stop_lat numeric, dropoff_stop_lng numeric,
  dropoff_distance_m double precision
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_max_distance_m < 1 or p_max_distance_m > 5000 then
    raise exception 'Distancia maxima no valida';
  end if;
  v_origin := extensions.st_setsrid(
    extensions.st_makepoint(p_origin_lng, p_origin_lat), 4326
  )::extensions.geography;
  v_destination := extensions.st_setsrid(
    extensions.st_makepoint(p_destination_lng, p_destination_lat), 4326
  )::extensions.geography;
  return query
  select ps.stop_id, pts.name, ps.address, ps.lat, ps.lng,
    extensions.st_distance(ps.location, v_origin),
    ds.stop_id, dts.name, ds.address, ds.lat, ds.lng,
    extensions.st_distance(ds.location, v_destination)
  from public.rides r
  join public.ride_stops ps
    on ps.ride_id = r.ride_id and ps.is_active and ps.route_version = r.version
  join public.transport_stops pts on pts.stop_id = ps.transport_stop_id
  join public.ride_stops ds
    on ds.ride_id = r.ride_id and ds.is_active
   and ds.route_version = r.version and ds.stop_order > ps.stop_order
  join public.transport_stops dts on dts.stop_id = ds.transport_stop_id
  where r.ride_id = p_ride_id and r.status = 'scheduled'
    and r.available_seats > 0
    and extensions.st_dwithin(ps.location, v_origin, p_max_distance_m)
    and extensions.st_dwithin(ds.location, v_destination, p_max_distance_m)
  order by
    extensions.st_distance(ps.location, v_origin)
    + extensions.st_distance(ds.location, v_destination),
    ps.stop_order, ds.stop_order
  limit 50;
end;
$$;

create or replace function public.request_booking_v2(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_booking_id uuid;
  v_pickup public.ride_stops%rowtype;
  v_dropoff public.ride_stops%rowtype;
  v_seats integer;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from public.users u where u.uuid = v_actor) then
    raise exception 'Perfil de usuario no encontrado';
  end if;
  select * into v_ride
  from public.rides r
  where r.ride_id = (p_payload->>'ride_id')::uuid
  for update;
  if not found then raise exception 'El viaje no existe'; end if;
  if v_ride.status <> 'scheduled' then
    raise exception 'El viaje no acepta reservaciones';
  end if;
  if exists (
    select 1 from public.driver_profiles dp
    where dp.driver_id = v_ride.driver_id and dp.user_id = v_actor
  ) then
    raise exception 'No puedes reservar tu propio viaje';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.user_id = v_actor
      and b.status in ('pending', 'confirmed', 'in_progress')
  ) then
    raise exception 'Ya tienes una reservacion activa';
  end if;
  v_seats := coalesce((p_payload->>'seats_reserved')::integer, 1);
  if v_seats < 1 or v_seats > v_ride.available_seats then
    raise exception 'No hay suficientes asientos disponibles';
  end if;
  select * into v_pickup from public.ride_stops rs
  where rs.stop_id = (p_payload->>'pickup_stop_id')::uuid
    and rs.ride_id = v_ride.ride_id and rs.is_active
    and rs.route_version = v_ride.version;
  select * into v_dropoff from public.ride_stops rs
  where rs.stop_id = (p_payload->>'dropoff_stop_id')::uuid
    and rs.ride_id = v_ride.ride_id and rs.is_active
    and rs.route_version = v_ride.version;
  if v_pickup.stop_id is null or v_dropoff.stop_id is null then
    raise exception 'Las paradas seleccionadas no son validas';
  end if;
  if v_pickup.transport_stop_id is null
     or v_dropoff.transport_stop_id is null
     or v_pickup.stop_order >= v_dropoff.stop_order then
    raise exception 'La parada de bajada debe estar despues de la subida';
  end if;
  insert into public.bookings (
    ride_id, user_id, pickup_stop_id, dropoff_stop_id,
    seats_reserved, status
  ) values (
    v_ride.ride_id, v_actor, v_pickup.stop_id, v_dropoff.stop_id,
    v_seats, 'pending'
  ) returning booking_id into v_booking_id;
  return v_booking_id;
end;
$$;

revoke all on function public.find_compatible_transport_stops(jsonb, integer) from public, anon;
revoke all on function public.upsert_favorite_route(jsonb) from public, anon;
revoke all on function public.delete_favorite_route(uuid) from public, anon;
revoke all on function public.create_ride_v2(jsonb) from public, anon;
revoke all on function public.update_ride_v2(uuid, integer, jsonb) from public, anon;
revoke all on function public.search_available_rides_v2(
  double precision, double precision, double precision, double precision,
  integer, timestamptz, timestamptz, integer
) from public, anon;
revoke all on function public.get_ride_stop_options(
  uuid, double precision, double precision, double precision,
  double precision, integer
) from public, anon;
revoke all on function public.request_booking_v2(jsonb) from public, anon;

grant execute on function public.find_compatible_transport_stops(jsonb, integer) to authenticated;
grant execute on function public.upsert_favorite_route(jsonb) to authenticated;
grant execute on function public.delete_favorite_route(uuid) to authenticated;
grant execute on function public.create_ride_v2(jsonb) to authenticated;
grant execute on function public.update_ride_v2(uuid, integer, jsonb) to authenticated;
grant execute on function public.search_available_rides_v2(
  double precision, double precision, double precision, double precision,
  integer, timestamptz, timestamptz, integer
) to authenticated;
grant execute on function public.get_ride_stop_options(
  uuid, double precision, double precision, double precision,
  double precision, integer
) to authenticated;
grant execute on function public.request_booking_v2(jsonb) to authenticated;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'create_ride', 'request_booking', 'search_available_rides',
        'update_booking_status', 'start_ride', 'cancel_ride',
        'complete_stop', 'complete_ride'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated', fn.signature);
  end loop;
end;
$$;
