begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Receipts are internal. Clients cannot read or write this table directly.
create table private.ride_publication_requests (
  actor_id uuid not null references public.users(uuid) on delete cascade,
  request_id uuid not null,
  request_payload jsonb not null check(jsonb_typeof(request_payload) = 'object'),
  ride_id uuid not null references public.rides(ride_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(actor_id, request_id)
);
create index ride_publication_requests_ride_idx
  on private.ride_publication_requests(ride_id);
alter table private.ride_publication_requests enable row level security;
revoke all on private.ride_publication_requests
  from public, anon, authenticated, krow_pilot_service;

-- Intentionally per-user SECURITY DEFINER: reads one owned receipt without
-- exposing the private schema or granting clients access to its tables.
create or replace function public.get_ride_publication(p_request_id uuid, p_request jsonb)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_ride_id uuid;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_request_id is null or jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'Solicitud de publicación inválida';
  end if;
  if not exists (
    select 1 from public.users
    where uuid = v_actor and is_active is distinct from false and deleted_at is null
  ) then raise exception 'La cuenta no está disponible'; end if;
  select request_payload, ride_id into v_payload, v_ride_id
  from private.ride_publication_requests
  where actor_id = v_actor and request_id = p_request_id;
  if found and v_payload is distinct from p_request then
    raise exception 'Conflicto de publicación: el identificador ya corresponde a otros datos';
  end if;
  return v_ride_id;
end;
$$;
revoke all on function public.get_ride_publication(uuid, jsonb) from public, anon;
grant execute on function public.get_ride_publication(uuid, jsonb)
  to authenticated, krow_pilot_service;

-- Preserve the existing publication validations and ACL. Legacy clients may
-- omit the request ID. New clients commit trip, stops and receipt atomically.
create or replace function public.create_ride_v2(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_request_id uuid;
  v_request jsonb;
  v_replayed uuid;
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
  v_request_id := nullif(p_payload->>'publication_request_id', '')::uuid;
  if v_request_id is not null then
    -- Same lock order as the private API: actor, then creation. Concurrent
    -- retries cannot both miss the receipt and insert different trips.
    perform 1 from public.users
    where uuid = v_actor and is_active is distinct from false and deleted_at is null
    for update;
    if not found then raise exception 'La cuenta no está disponible'; end if;
    v_request := p_payload->'publication_request';
    v_replayed := public.get_ride_publication(v_request_id, v_request);
    if v_replayed is not null then return v_replayed; end if;
  end if;
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
  if v_request_id is not null then
    insert into private.ride_publication_requests(actor_id, request_id, request_payload, ride_id)
    values (v_actor, v_request_id, v_request, v_ride_id);
  end if;
  return v_ride_id;
end;
$$;

commit;

