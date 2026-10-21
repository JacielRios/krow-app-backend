-- Only new records default to dropoff_only. Existing catalog roles and ride snapshots stay intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.transport_stops drop constraint if exists transport_stops_stop_type_check;
alter table public.transport_stops add constraint transport_stops_stop_type_check
  check(stop_type in ('general','official_boarding_zone','dropoff_only'));

create or replace function public.admin_upsert_transport_stop(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p_payload->>'stop_id','')::uuid;
  v_previous public.transport_stops%rowtype;
  v_shift public.transport_stops%rowtype;
  v_type text := coalesce(p_payload->>'stop_type','general');
  v_insert boolean := coalesce((p_payload->>'insert_at_order')::boolean,false);
  v_catalog_version text;
  v_corridor uuid;
  v_order integer;
  v_direction text;
  v_active boolean := coalesce((p_payload->>'active')::boolean,true);
  v_lat double precision := (p_payload->>'latitude')::double precision;
  v_lng double precision := (p_payload->>'longitude')::double precision;
begin
  if not private.is_current_admin() or not private.is_admin_actor() then raise exception 'Acceso administrativo requerido'; end if;
  if v_id is not null then
    select * into v_previous from public.transport_stops where stop_id=v_id;
    if not found then raise exception 'Parada no encontrada'; end if;
  end if;
  v_corridor:=case when p_payload ? 'corridor_id' then nullif(p_payload->>'corridor_id','')::uuid else v_previous.corridor_id end;
  v_order:=case when p_payload ? 'corridor_order' then (p_payload->>'corridor_order')::integer else v_previous.corridor_order end;
  v_direction:=case when p_payload ? 'direction' then nullif(btrim(p_payload->>'direction'),'') else v_previous.direction end;
  if nullif(btrim(p_payload->>'external_id'),'') is null or nullif(btrim(p_payload->>'name'),'') is null then
    raise exception 'External ID y nombre son requeridos';
  end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then raise exception 'Coordenadas no validas'; end if;
  if coalesce(p_payload->>'stop_type','general') not in ('general','official_boarding_zone','dropoff_only') then raise exception 'Tipo de parada no valido'; end if;
  if v_corridor is not null then
    perform 1 from public.transport_corridors where corridor_id=v_corridor and active for update;
    if not found then raise exception 'Selecciona una avenida activa'; end if;
    if v_order is null or v_order not between 1 and 10000 then raise exception 'Indica el orden de la parada en la avenida'; end if;
  else
    v_order:=null;
  end if;
  if not v_active and exists(
    select 1 from public.ride_stops s join public.bookings b on b.pickup_stop_id=s.stop_id or b.dropoff_stop_id=s.stop_id
    join public.rides r on r.ride_id=b.ride_id
    where s.transport_stop_id=v_id and r.status in ('scheduled','full','in_progress') and b.status in ('pending','confirmed','in_progress')
  ) then raise exception 'La parada tiene reservas pendientes. Atiende esos viajes antes de desactivarla'; end if;
  if v_id is not null then
    perform 1 from public.transport_stops where stop_id=v_id for update;
  end if;
  if v_type='dropoff_only' and v_active and v_corridor is null then
    raise exception 'Vincula la parada de descenso a una avenida antes de activarla';
  end if;
  if v_type='dropoff_only' and (p_payload->>'external_id'='krow-initial-stop-2' or v_previous.external_id='krow-initial-stop-2') then
    raise exception 'La salida del ITNL no puede convertirse en una parada de solo descenso';
  end if;
  if v_type='dropoff_only' and v_previous.stop_type is distinct from 'dropoff_only' and exists(
    select 1 from public.ride_stops s join public.bookings b on b.pickup_stop_id=s.stop_id
    join public.rides r on r.ride_id=b.ride_id
    where s.transport_stop_id=v_id and r.status in ('scheduled','full','in_progress')
      and b.status in ('pending','confirmed','in_progress')
  ) then raise exception 'La parada tiene ascensos comprometidos. Atiende esos viajes antes de cambiar su tipo'; end if;
  if v_insert then
    if v_id is not null then raise exception 'La inserción ordenada solo corresponde a nuevas paradas'; end if;
    if v_corridor is not null and v_active then
      select md5(coalesce(string_agg(stop_id::text||':'||corridor_order::text||':'||coalesce(floor(extract(epoch from updated_at)*1000)::bigint::text,''),'|' order by stop_id),'')) into v_catalog_version
        from public.transport_stops where corridor_id=v_corridor and active and corridor_order is not null;
      if nullif(p_payload->>'expected_catalog_version','') is not null and p_payload->>'expected_catalog_version' <> v_catalog_version then
        raise exception 'El catálogo de esta avenida cambió. Reintenta los datos de la ubicación y confirma el orden antes de guardar';
      end if;
      if exists(select 1 from public.transport_stops where corridor_id=v_corridor and active and corridor_order>=v_order and corridor_order>=10000) then
        raise exception 'La avenida alcanzó el límite de posiciones. Revisa el catálogo';
      end if;
      -- Descending updates respect the existing partial unique index at every row.
      for v_shift in select * from public.transport_stops where corridor_id=v_corridor and active and corridor_order>=v_order order by corridor_order desc for update loop
        update public.transport_stops set corridor_order=v_shift.corridor_order+1,updated_at=now() where stop_id=v_shift.stop_id;
        insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id,changes)
        values(auth.uid(),'reordered','transport_stop',v_shift.stop_id,jsonb_build_object('before',jsonb_build_object('corridor_order',v_shift.corridor_order),'after',jsonb_build_object('corridor_order',v_shift.corridor_order+1)));
      end loop;
    end if;
  end if;
  begin
    if v_id is null then
      insert into public.transport_stops(external_id,name,address,municipality,latitude,longitude,source,active,stop_type,corridor_id,corridor_order,direction)
      values(btrim(p_payload->>'external_id'),btrim(p_payload->>'name'),nullif(btrim(p_payload->>'address'),''),nullif(btrim(p_payload->>'municipality'),''),v_lat,v_lng,'krow_admin',v_active,coalesce(p_payload->>'stop_type','general'),v_corridor,v_order,v_direction)
      returning stop_id into v_id;
    else
      update public.transport_stops set external_id=btrim(p_payload->>'external_id'),name=btrim(p_payload->>'name'),address=nullif(btrim(p_payload->>'address'),''),municipality=nullif(btrim(p_payload->>'municipality'),''),latitude=v_lat,longitude=v_lng,active=v_active,stop_type=coalesce(p_payload->>'stop_type','general'),corridor_id=v_corridor,corridor_order=v_order,direction=v_direction,updated_at=now() where stop_id=v_id;
    end if;
  exception when unique_violation then raise exception 'El identificador o el orden de la parada ya están en uso'; end;
  insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id,changes)
  values(auth.uid(),'saved','transport_stop',v_id,jsonb_build_object('before',case when v_previous.stop_id is not null then to_jsonb(v_previous) end,'after',p_payload));
  return v_id;
end;
$$;
revoke all on function public.admin_upsert_transport_stop(jsonb) from public,anon;
grant execute on function public.admin_upsert_transport_stop(jsonb) to authenticated;


-- Preserve original signatures, guards and grants; restrict only pickup candidates.
CREATE OR REPLACE FUNCTION public.search_available_rides_by_stops(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_pickup_transport_stop_id uuid, p_dropoff_transport_stop_id uuid, p_max_results integer DEFAULT 50, p_from_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_max_distance_m integer DEFAULT 1000)
 RETURNS TABLE(ride_id uuid, driver_id uuid, driver_name text, driver_rating numeric, vehicle_id uuid, vehicle_brand text, vehicle_model text, vehicle_plate text, vehicle_color text, vehicle_capacity integer, origin_lat numeric, origin_lng numeric, destination_lat numeric, destination_lng numeric, origin_address text, destination_address text, route_polyline text, route_distance_meters integer, route_duration_seconds integer, departure_time timestamp with time zone, available_seats integer, price_per_seat numeric, status text, pickup_stop_id uuid, pickup_stop_name text, pickup_stop_address text, pickup_stop_lat numeric, pickup_stop_lng numeric, pickup_distance_m double precision, dropoff_stop_id uuid, dropoff_stop_name text, dropoff_stop_address text, dropoff_stop_lat numeric, dropoff_stop_lng numeric, dropoff_distance_m double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
  -- The published trip origin is fixed; passenger pickup may be an intermediate stop.
  v_campus extensions.geography := extensions.st_setsrid(
    extensions.st_makepoint(-100.243225, 25.664011), 4326
  )::extensions.geography;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_pickup_transport_stop_id = p_dropoff_transport_stop_id then
    raise exception 'Selecciona paradas diferentes';
  end if;
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
    ps.stop_id, pts.name, ps.address, ps.lat, ps.lng,
    extensions.st_distance(ps.location, v_origin),
    ds.stop_id, dts.name, ds.address, ds.lat, ds.lng,
    extensions.st_distance(ds.location, v_destination)
  from public.rides r
  join public.driver_profiles dp on dp.driver_id = r.driver_id
  join public.users u on u.uuid = dp.user_id
  join public.vehicles v on v.vehicle_id = r.vehicle_id
  join public.ride_stops ps
    on ps.ride_id = r.ride_id
   and ps.is_active
   and ps.route_version = r.version
   and ps.transport_stop_id = p_pickup_transport_stop_id
  join public.transport_stops pts
    on pts.stop_id = ps.transport_stop_id and pts.active and pts.stop_type <> 'dropoff_only'
  join public.ride_stops ds
    on ds.ride_id = r.ride_id
   and ds.is_active
   and ds.route_version = r.version
   and ds.stop_order > ps.stop_order
   and ds.transport_stop_id = p_dropoff_transport_stop_id
  join public.transport_stops dts
    on dts.stop_id = ds.transport_stop_id and dts.active
  where r.status = 'scheduled'
    and r.available_seats > 0
    and r.departure_time >= coalesce(p_from_time, now())
    and (p_to_time is null or r.departure_time <= p_to_time)
    and dp.user_id <> v_actor
    and extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(
        r.origin_lng::double precision, r.origin_lat::double precision
      ), 4326)::extensions.geography,
      v_campus, 100
    )
    and extensions.st_dwithin(ps.location, v_origin, p_max_distance_m)
    and extensions.st_dwithin(ds.location, v_destination, p_max_distance_m)
  order by r.departure_time
  limit p_max_results;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_available_rides_v2(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_max_results integer DEFAULT 50, p_from_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_max_distance_m integer DEFAULT 500)
 RETURNS TABLE(ride_id uuid, driver_id uuid, driver_name text, driver_rating numeric, vehicle_id uuid, vehicle_brand text, vehicle_model text, vehicle_plate text, vehicle_color text, vehicle_capacity integer, origin_lat numeric, origin_lng numeric, destination_lat numeric, destination_lng numeric, origin_address text, destination_address text, route_polyline text, route_distance_meters integer, route_duration_seconds integer, departure_time timestamp with time zone, available_seats integer, price_per_seat numeric, status text, pickup_stop_id uuid, pickup_stop_name text, pickup_stop_address text, pickup_stop_lat numeric, pickup_stop_lng numeric, pickup_distance_m double precision, dropoff_stop_id uuid, dropoff_stop_name text, dropoff_stop_address text, dropoff_stop_lat numeric, dropoff_stop_lng numeric, dropoff_distance_m double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
  -- The published trip origin is fixed; passenger pickup may be an intermediate stop.
  v_campus extensions.geography := extensions.st_setsrid(
    extensions.st_makepoint(-100.243225, 25.664011), 4326
  )::extensions.geography;
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
    join public.transport_stops pts on pts.stop_id = ps.transport_stop_id and pts.active and pts.stop_type <> 'dropoff_only'
    join public.ride_stops ds
      on ds.ride_id = ps.ride_id and ds.is_active
     and ds.stop_order > ps.stop_order
    join public.transport_stops dts on dts.stop_id = ds.transport_stop_id and dts.active
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
    and extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(
        r.origin_lng::double precision, r.origin_lat::double precision
      ), 4326)::extensions.geography,
      v_campus, 100
    )
  order by r.departure_time
  limit p_max_results;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_passenger_stop_candidates_v2(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_max_distance_m integer, p_pickup_scope text)
 RETURNS TABLE(stop_role text, stop_id uuid, external_id text, stop_name text, stop_address text, municipality text, stop_type text, lat numeric, lng numeric, distance_m double precision, enabled boolean, ride_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
  -- The published trip origin is fixed; passenger pickup may be an intermediate stop.
  v_campus extensions.geography := extensions.st_setsrid(
    extensions.st_makepoint(-100.243225, 25.664011), 4326
  )::extensions.geography;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_pickup_scope is null or p_pickup_scope not in ('campus', 'route') then
    raise exception 'Alcance de subida no valido';
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
  with candidates as (
    select 'pickup'::text as candidate_role, ts.*,
      extensions.st_distance(ts.location, v_origin) as candidate_distance
    from public.transport_stops ts
    where ts.active and ts.stop_type <> 'dropoff_only'
      and (p_pickup_scope = 'route'
        or extensions.st_dwithin(ts.location, v_campus, p_max_distance_m))
    union all
    select 'dropoff'::text, ts.*,
      extensions.st_distance(ts.location, v_destination)
    from public.transport_stops ts
    where ts.active
      and extensions.st_dwithin(ts.location, v_destination, p_max_distance_m)
  )
  select
    c.candidate_role,
    c.stop_id,
    c.external_id,
    c.name,
    c.address,
    c.municipality,
    c.stop_type,
    c.latitude::numeric,
    c.longitude::numeric,
    c.candidate_distance,
    availability.ride_count > 0,
    availability.ride_count
  from candidates c
  cross join lateral (
    select count(distinct r.ride_id) as ride_count
    from public.rides r
    join public.driver_profiles dp on dp.driver_id = r.driver_id
    join public.ride_stops selected_stop
      on selected_stop.ride_id = r.ride_id
     and selected_stop.is_active
     and selected_stop.route_version = r.version
     and selected_stop.transport_stop_id = c.stop_id
    where r.status = 'scheduled'
      and r.available_seats > 0
      and r.departure_time >= now()
      and dp.user_id <> v_actor
      and extensions.st_dwithin(
        extensions.st_setsrid(extensions.st_makepoint(
          r.origin_lng::double precision, r.origin_lat::double precision
        ), 4326)::extensions.geography,
        v_campus, 100
      )
      and (
        (
          c.candidate_role = 'pickup'
          and exists (
            select 1
            from public.ride_stops counterpart
            join public.transport_stops counterpart_catalog
              on counterpart_catalog.stop_id = counterpart.transport_stop_id
             and counterpart_catalog.active
            where counterpart.ride_id = r.ride_id
              and counterpart.is_active
              and counterpart.route_version = r.version
              and counterpart.stop_order > selected_stop.stop_order
              and extensions.st_dwithin(
                counterpart.location, v_destination, p_max_distance_m
              )
          )
        )
        or
        (
          c.candidate_role = 'dropoff'
          and exists (
            select 1
            from public.ride_stops counterpart
            join public.transport_stops counterpart_catalog
              on counterpart_catalog.stop_id = counterpart.transport_stop_id
             and counterpart_catalog.active
            where counterpart.ride_id = r.ride_id
              and counterpart.is_active
              and counterpart.route_version = r.version
              and counterpart.stop_order < selected_stop.stop_order
              and counterpart_catalog.stop_type <> 'dropoff_only'
              and (p_pickup_scope = 'route' or extensions.st_dwithin(
                counterpart.location, v_campus, p_max_distance_m
              ))
          )
        )
      )
  ) availability
  order by
    c.candidate_role,
    (availability.ride_count > 0) desc,
    (c.stop_type = 'official_boarding_zone') desc,
    c.candidate_distance,
    c.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_passenger_stop_pairs_v2(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_max_distance_m integer, p_pickup_scope text)
 RETURNS TABLE(pickup_transport_stop_id uuid, dropoff_transport_stop_id uuid, ride_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_origin extensions.geography;
  v_destination extensions.geography;
  -- The published trip origin is fixed; passenger pickup may be an intermediate stop.
  v_campus extensions.geography := extensions.st_setsrid(
    extensions.st_makepoint(-100.243225, 25.664011), 4326
  )::extensions.geography;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if p_pickup_scope is null or p_pickup_scope not in ('campus', 'route') then
    raise exception 'Alcance de subida no valido';
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
    ps.transport_stop_id,
    ds.transport_stop_id,
    count(distinct r.ride_id)
  from public.rides r
  join public.driver_profiles dp on dp.driver_id = r.driver_id
  join public.ride_stops ps
    on ps.ride_id = r.ride_id
   and ps.is_active
   and ps.route_version = r.version
  join public.transport_stops pts
    on pts.stop_id = ps.transport_stop_id and pts.active and pts.stop_type <> 'dropoff_only'
  join public.ride_stops ds
    on ds.ride_id = r.ride_id
   and ds.is_active
   and ds.route_version = r.version
   and ds.stop_order > ps.stop_order
  join public.transport_stops dts
    on dts.stop_id = ds.transport_stop_id and dts.active
  where r.status = 'scheduled'
    and r.available_seats > 0
    and r.departure_time >= now()
    and dp.user_id <> v_actor
    and extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(
        r.origin_lng::double precision, r.origin_lat::double precision
      ), 4326)::extensions.geography,
      v_campus, 100
    )
    and (p_pickup_scope = 'route'
      or extensions.st_dwithin(ps.location, v_campus, p_max_distance_m))
    and extensions.st_dwithin(ds.location, v_destination, p_max_distance_m)
  group by ps.transport_stop_id, ds.transport_stop_id
  order by count(distinct r.ride_id) desc,
    ps.transport_stop_id, ds.transport_stop_id;
end;
$function$;

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
   select pickup.* from public.ride_stops pickup join public.transport_stops ts on ts.stop_id=pickup.transport_stop_id and ts.active and ts.stop_type <> 'dropoff_only'
   where pickup.ride_id=r.ride_id and pickup.route_version=r.version and pickup.is_active
     and ((r.corridor_id is not null and ts.external_id='krow-initial-stop-2') or
       (r.corridor_id is null and private.pilot_distance_m(pickup.lat::double precision,pickup.lng::double precision,r.origin_lat::double precision,r.origin_lng::double precision)<=500))
   order by private.pilot_distance_m(pickup.lat::double precision,pickup.lng::double precision,r.origin_lat::double precision,r.origin_lng::double precision),pickup.stop_order limit 1
 ) ps on true
 join public.transport_stops pts on pts.stop_id=ps.transport_stop_id and pts.active and pts.stop_type <> 'dropoff_only'
 join public.ride_stops ds on ds.ride_id=r.ride_id and ds.route_version=r.version and ds.is_active and ds.stop_order>ps.stop_order
 join public.transport_stops dts on dts.stop_id=ds.transport_stop_id and dts.active
 where r.ride_id=p_ride_id and r.status='scheduled' and r.available_seats>0
 order by private.pilot_distance_m(ds.lat::double precision,ds.lng::double precision,p_destination_lat,p_destination_lng),ds.stop_order,ds.stop_id;
end;
$$;

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
  select stop_id into v_campus from public.transport_stops where external_id='krow-initial-stop-2' and active and stop_type <> 'dropoff_only';
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

-- Defense at the write boundary, including stale clients and alternate booking RPCs.
create or replace function private.validate_dropoff_only_pickup()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' and new.pickup_stop_id is not distinct from old.pickup_stop_id and new.ride_id is not distinct from old.ride_id then return new; end if;
  perform 1 from public.transport_stops ts join public.ride_stops rs on rs.transport_stop_id=ts.stop_id
    where rs.stop_id=new.pickup_stop_id and ts.stop_type='dropoff_only' for share of ts;
  if found then raise exception 'Esta parada es solo de descenso; selecciona un punto de ascenso permitido'; end if;
  return new;
end;
$$;
revoke all on function private.validate_dropoff_only_pickup() from public,anon,authenticated;
create trigger bookings_validate_dropoff_only_pickup
before insert or update of pickup_stop_id,ride_id on public.bookings
for each row execute function private.validate_dropoff_only_pickup();
commit;
