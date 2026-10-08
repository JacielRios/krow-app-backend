-- Expandable avenues reuse the catalog and versioned ride/favorite stops.
-- Nullable relationships preserve existing trips and all committed bookings.
create table public.transport_corridors (
  corridor_id uuid primary key default gen_random_uuid(),
  code text not null unique check(length(btrim(code)) between 1 and 80),
  name text not null check(length(btrim(name)) between 1 and 120),
  direction text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.transport_corridors enable row level security;
create policy corridor_catalog_read on public.transport_corridors for select
  to authenticated using(active);
revoke all on public.transport_corridors from public,anon,authenticated;
grant select on public.transport_corridors to authenticated,krow_pilot_service;
create policy pilot_corridor_read on public.transport_corridors for select
  to krow_pilot_service using(true);

alter table public.transport_stops
  add column corridor_id uuid references public.transport_corridors(corridor_id) on delete restrict,
  add column corridor_order integer check(corridor_order > 0),
  add column direction text;
alter table public.rides add column corridor_id uuid references public.transport_corridors(corridor_id) on delete restrict;
alter table public.favorite_routes add column corridor_id uuid references public.transport_corridors(corridor_id) on delete restrict;
create index transport_stops_corridor_order_idx on public.transport_stops(corridor_id,corridor_order) where active;
create index rides_corridor_idx on public.rides(corridor_id) where corridor_id is not null;
create index favorite_routes_corridor_idx on public.favorite_routes(corridor_id) where corridor_id is not null;

insert into public.transport_corridors(code,name,direction,display_order) values
  ('pablo-livas','Av. Pablo Livas',null,1),
  ('eloy-cavazos','Av. Eloy Cavazos',null,2),
  ('reynosa','Av. Reynosa',null,3);

-- Municipal route sources identify actual bus stops. Avenue assignment follows
-- published coordinates; the exact sidewalk/direction still needs a field visit.
-- Keep curated meeting references (general) distinguishable from these stops.
insert into public.transport_stops(external_id,name,address,municipality,latitude,longitude,source,stop_type,active)
values
 ('gnm-azul-san-sebastian','San Sebastián · parada Ruta Azul','Av. Eloy Cavazos / San Sebastián','Guadalupe',25.65437941821169,-100.20861089229584,'https://nosmueve.guadalupe.gob.mx/rutas/ruta-azul','official_boarding_zone',true),
 ('gnm-azul-pablo-livas','Av. Pablo Livas · parada Ruta Azul','Av. Pablo Livas','Guadalupe',25.665410364306176,-100.21033287048341,'https://nosmueve.guadalupe.gob.mx/rutas/ruta-azul','official_boarding_zone',true),
 ('gnm-azul-eloy-cavazos','Eloy Cavazos · parada Ruta Azul','Av. Eloy Cavazos / México 86','Guadalupe',25.651431917018765,-100.19735097885133,'https://nosmueve.guadalupe.gob.mx/rutas/ruta-azul','official_boarding_zone',true),
 ('gnm-naranja-enredadera','Enredadera · parada Ruta Naranja','Av. Reynosa / Enredadera','Guadalupe',25.670888973033485,-100.18335696331856,'https://nosmueve.guadalupe.gob.mx/rutas/ruta-naranja','official_boarding_zone',true)
on conflict(external_id) do nothing;

with catalog as (
  select ts.stop_id,c.corridor_id,c.direction,
    row_number() over(partition by c.corridor_id order by ts.longitude,ts.latitude,ts.stop_id)::integer stop_order
  from public.transport_stops ts join public.transport_corridors c on
    (c.code='pablo-livas' and (ts.external_id like 'krow-itnl-pablo-%' or ts.external_id='gnm-azul-pablo-livas')) or
    (c.code='eloy-cavazos' and (ts.external_id like 'krow-itnl-eloy-%' or ts.external_id in ('gnm-azul-san-sebastian','gnm-azul-eloy-cavazos'))) or
    (c.code='reynosa' and (ts.external_id like 'krow-itnl-reynosa-%' or ts.external_id='gnm-naranja-enredadera'))
)
update public.transport_stops ts set corridor_id=catalog.corridor_id,
  corridor_order=catalog.stop_order,direction=catalog.direction
from catalog where catalog.stop_id=ts.stop_id;

-- Pure geodesic approximation, shared by ranking and all ride-stop options.
-- Returned distance is not a walking itinerary or a guarantee about crossings.
create or replace function private.pilot_distance_m(
  a_lat double precision,a_lng double precision,b_lat double precision,b_lng double precision
) returns double precision language sql immutable strict set search_path='' as $$
  select 6371008.8*2*asin(sqrt(least(1.0,greatest(0.0,
    power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lng-a_lng)/2),2)
  ))));
$$;
revoke all on function private.pilot_distance_m(double precision,double precision,double precision,double precision) from public,anon;
grant execute on function private.pilot_distance_m(double precision,double precision,double precision,double precision) to authenticated,krow_pilot_service;

-- Only the API may call publishing RPCs. This guard supplements their existing
-- driver ownership, route geometry, capacity, version and booking checks.
create or replace function private.validate_pilot_corridor(p_payload jsonb)
returns uuid language plpgsql set search_path='' as $$
declare v_corridor uuid:=nullif(p_payload->>'corridor_id','')::uuid;
  v_ids uuid[]; v_campus uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  perform 1 from public.transport_corridors c where c.corridor_id=v_corridor and c.active for share;
  if v_corridor is null or not found then
    raise exception 'Selecciona una avenida activa';
  end if;
  select stop_id into v_campus from public.transport_stops where external_id='krow-initial-stop-2' and active;
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_payload->'transport_stop_ids','[]'::jsonb));
  perform 1 from public.transport_stops where stop_id=any(v_ids) for share;
  if v_campus is null or not coalesce(v_campus=any(v_ids),false) or coalesce(cardinality(v_ids),0)<2 then
    raise exception 'Selecciona al menos una parada de descenso y conserva la salida del ITNL';
  end if;
  if cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) or exists(
    select 1 from unnest(v_ids) id where id<>v_campus and not exists(
      select 1 from public.transport_stops ts where ts.stop_id=id and ts.active and ts.corridor_id=v_corridor
    )
  ) then raise exception 'Las paradas seleccionadas no pertenecen a la avenida activa'; end if;
  return v_corridor;
end;
$$;
revoke all on function private.validate_pilot_corridor(jsonb) from public,anon,authenticated;

-- Preserve the existing RPC bodies and their private-writer permissions.

create or replace function public.upsert_favorite_route(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_corridor_id uuid;
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
  v_corridor_id:=private.validate_pilot_corridor(p_payload);
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
      corridor_id, driver_id, name, origin_place_id, origin_address, origin_lat, origin_lng,
      destination_place_id, destination_address, destination_lat, destination_lng,
      default_vehicle_id, default_available_seats, default_price_per_seat
    ) values (
      v_corridor_id, v_driver_id, v_route_name,
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
    set corridor_id=v_corridor_id, name = v_route_name,
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

create or replace function public.create_ride_v2(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_corridor_id uuid;
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
  v_corridor_id:=private.validate_pilot_corridor(p_payload);
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
    corridor_id, driver_id, vehicle_id, favorite_route_id,
    origin_lat, origin_lng, destination_lat, destination_lng,
    origin_address, destination_address, route_polyline,
    route_distance_meters, route_duration_seconds, route_provider,
    route_calculated_at, departure_time, available_seats,
    price_per_seat, status
  ) values (
    v_corridor_id, v_driver_id, v_vehicle_id, v_favorite_route_id,
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
  v_corridor_id uuid;
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
  v_corridor_id:=private.validate_pilot_corridor(p_payload);
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
  set corridor_id=v_corridor_id, vehicle_id = v_vehicle_id,
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
-- All published active descents remain selectable, independently of matching radius.
create or replace function private.pilot_stop_pairs(p_ride_id uuid,p_destination_lat double precision,p_destination_lng double precision)
returns table (
 pickup_stop_id uuid,pickup_stop_name text,pickup_stop_address text,pickup_stop_lat numeric,pickup_stop_lng numeric,pickup_distance_m double precision,
 dropoff_stop_id uuid,dropoff_stop_name text,dropoff_stop_address text,dropoff_stop_lat numeric,dropoff_stop_lng numeric,dropoff_distance_m double precision
) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if p_destination_lat is null or p_destination_lng is null or p_destination_lat not between -90 and 90 or p_destination_lng not between -180 and 180 then raise exception 'Destino no valido'; end if;
 if not exists(select 1 from public.users where uuid=auth.uid() and is_active is distinct from false and deleted_at is null) then raise exception 'La cuenta no está disponible'; end if;
 return query
 select ps.stop_id,pts.name,ps.address,ps.lat,ps.lng,
   private.pilot_distance_m(ps.lat::double precision,ps.lng::double precision,r.origin_lat::double precision,r.origin_lng::double precision),
   ds.stop_id,dts.name,ds.address,ds.lat,ds.lng,
   private.pilot_distance_m(ds.lat::double precision,ds.lng::double precision,p_destination_lat,p_destination_lng)
 from public.rides r
 join lateral (
   select pickup.* from public.ride_stops pickup join public.transport_stops ts on ts.stop_id=pickup.transport_stop_id and ts.active
   where pickup.ride_id=r.ride_id and pickup.route_version=r.version and pickup.is_active
     and ((r.corridor_id is not null and ts.external_id='krow-initial-stop-2') or
       (r.corridor_id is null and private.pilot_distance_m(pickup.lat::double precision,pickup.lng::double precision,r.origin_lat::double precision,r.origin_lng::double precision)<=500))
   order by private.pilot_distance_m(pickup.lat::double precision,pickup.lng::double precision,r.origin_lat::double precision,r.origin_lng::double precision),pickup.stop_order limit 1
 ) ps on true
 join public.transport_stops pts on pts.stop_id=ps.transport_stop_id and pts.active
 join public.ride_stops ds on ds.ride_id=r.ride_id and ds.route_version=r.version and ds.is_active and ds.stop_order>ps.stop_order
 join public.transport_stops dts on dts.stop_id=ds.transport_stop_id and dts.active
 where r.ride_id=p_ride_id and r.status='scheduled' and r.available_seats>0
 order by private.pilot_distance_m(ds.lat::double precision,ds.lng::double precision,p_destination_lat,p_destination_lng),ds.stop_order,ds.stop_id;
end;
$$;
revoke all on function private.pilot_stop_pairs(uuid,double precision,double precision) from public,anon;
grant execute on function private.pilot_stop_pairs(uuid,double precision,double precision) to authenticated,krow_pilot_service;

create or replace function public.get_ride_stop_options_pilot(
 p_ride_id uuid,p_origin_lat double precision,p_origin_lng double precision,p_destination_lat double precision,p_destination_lng double precision,p_max_distance_m integer default 3000
) returns table (
 pickup_stop_id uuid,pickup_stop_name text,pickup_stop_address text,pickup_stop_lat numeric,pickup_stop_lng numeric,pickup_distance_m double precision,
 dropoff_stop_id uuid,dropoff_stop_name text,dropoff_stop_address text,dropoff_stop_lat numeric,dropoff_stop_lng numeric,dropoff_distance_m double precision
) language sql stable security invoker set search_path='' as $$
 select * from private.pilot_stop_pairs(p_ride_id,p_destination_lat,p_destination_lng)
$$;
revoke all on function public.get_ride_stop_options_pilot(uuid,double precision,double precision,double precision,double precision,integer) from public,anon;
grant execute on function public.get_ride_stop_options_pilot(uuid,double precision,double precision,double precision,double precision,integer) to authenticated,krow_pilot_service;

create or replace function private.search_available_rides_pilot(
 p_origin_lat double precision,p_origin_lng double precision,p_destination_lat double precision,p_destination_lng double precision,p_max_results integer default 50,p_from_time timestamptz default null,p_to_time timestamptz default null,p_max_distance_m integer default 3000
) returns table (
 ride_id uuid,driver_id uuid,driver_name text,driver_rating numeric,
 vehicle_id uuid,vehicle_brand text,vehicle_model text,vehicle_plate text,vehicle_color text,vehicle_capacity integer,
 origin_lat numeric,origin_lng numeric,destination_lat numeric,destination_lng numeric,origin_address text,destination_address text,route_polyline text,
 route_distance_meters integer,route_duration_seconds integer,departure_time timestamptz,available_seats integer,price_per_seat numeric,status text,
 pickup_stop_id uuid,pickup_stop_name text,pickup_stop_address text,pickup_stop_lat numeric,pickup_stop_lng numeric,pickup_distance_m double precision,
 dropoff_stop_id uuid,dropoff_stop_name text,dropoff_stop_address text,dropoff_stop_lat numeric,dropoff_stop_lng numeric,dropoff_distance_m double precision,
 corridor_id uuid,corridor_name text
) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if not exists(select 1 from public.users where uuid=auth.uid() and is_active is distinct from false and deleted_at is null) then raise exception 'La cuenta no está disponible'; end if;
 if p_max_results is null or p_max_results not between 1 and 100 then raise exception 'Limite de resultados no valido'; end if;
 if p_max_distance_m is null or p_max_distance_m not between 1 and 20000 then raise exception 'Distancia maxima no valida'; end if;
 if p_destination_lat is null or p_destination_lng is null or p_destination_lat not between -90 and 90 or p_destination_lng not between -180 and 180 then raise exception 'Destino no valido'; end if;
 if p_from_time is not null and p_to_time is not null and p_from_time>p_to_time then raise exception 'El rango de fechas no es valido'; end if;
 return query
 select r.ride_id,r.driver_id,u.full_name,dp.rating,v.vehicle_id,v.brand,v.model,v.license_plate,v.car_color,v.capacity,
 r.origin_lat,r.origin_lng,r.destination_lat,r.destination_lng,r.origin_address,r.destination_address,r.route_polyline,
 r.route_distance_meters,r.route_duration_seconds,r.departure_time,r.available_seats,r.price_per_seat,r.status,
 pair.pickup_stop_id,pair.pickup_stop_name,pair.pickup_stop_address,pair.pickup_stop_lat,pair.pickup_stop_lng,pair.pickup_distance_m,
 pair.dropoff_stop_id,pair.dropoff_stop_name,pair.dropoff_stop_address,pair.dropoff_stop_lat,pair.dropoff_stop_lng,pair.dropoff_distance_m,
 r.corridor_id,c.name
 from public.rides r join public.driver_profiles dp on dp.driver_id=r.driver_id and dp.status='approved'
 join public.users u on u.uuid=dp.user_id and u.is_active is distinct from false and u.deleted_at is null
 join public.vehicles v on v.vehicle_id=r.vehicle_id and v.is_active
 left join public.transport_corridors c on c.corridor_id=r.corridor_id
 join lateral (select * from private.pilot_stop_pairs(r.ride_id,p_destination_lat,p_destination_lng) options order by options.dropoff_distance_m,options.dropoff_stop_id limit 1) pair on true
 where r.status='scheduled' and r.available_seats>0 and dp.user_id<>auth.uid()
   and r.departure_time>=greatest(coalesce(p_from_time,now()),now()) and (p_to_time is null or r.departure_time<=p_to_time)
   and private.pilot_distance_m(r.origin_lat::double precision,r.origin_lng::double precision,25.664011,-100.243225)<=250
   and pair.dropoff_distance_m<=p_max_distance_m and (r.corridor_id is null or c.active)
 order by pair.dropoff_distance_m,r.departure_time,r.ride_id limit p_max_results;
end;
$$;
revoke all on function private.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer) from public,anon;
grant execute on function private.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer) to authenticated,krow_pilot_service;

create or replace function public.search_available_rides_pilot(
 p_origin_lat double precision,p_origin_lng double precision,p_destination_lat double precision,p_destination_lng double precision,p_max_results integer default 50,p_from_time timestamptz default null,p_to_time timestamptz default null,p_max_distance_m integer default 3000
) returns table (
 ride_id uuid,driver_id uuid,driver_name text,driver_rating numeric,
 vehicle_id uuid,vehicle_brand text,vehicle_model text,vehicle_plate text,vehicle_color text,vehicle_capacity integer,
 origin_lat numeric,origin_lng numeric,destination_lat numeric,destination_lng numeric,origin_address text,destination_address text,route_polyline text,
 route_distance_meters integer,route_duration_seconds integer,departure_time timestamptz,available_seats integer,price_per_seat numeric,status text,
 pickup_stop_id uuid,pickup_stop_name text,pickup_stop_address text,pickup_stop_lat numeric,pickup_stop_lng numeric,pickup_distance_m double precision,
 dropoff_stop_id uuid,dropoff_stop_name text,dropoff_stop_address text,dropoff_stop_lat numeric,dropoff_stop_lng numeric,dropoff_distance_m double precision,
 corridor_id uuid,corridor_name text
) language sql stable security invoker set search_path='' as $$
 select * from private.search_available_rides_pilot(p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_max_results,p_from_time,p_to_time,p_max_distance_m)
$$;
revoke all on function public.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer) to authenticated,krow_pilot_service;

-- Never reopen business mutations to direct mobile/PostgREST calls.
revoke all on function public.create_ride_v2(jsonb),public.update_ride_v2(uuid,integer,jsonb),public.upsert_favorite_route(jsonb) from public,anon,authenticated;
grant execute on function public.create_ride_v2(jsonb),public.update_ride_v2(uuid,integer,jsonb),public.upsert_favorite_route(jsonb) to krow_pilot_service;
notify pgrst,'reload schema';
