-- Limit new searches to trips departing Instituto Tecnológico de Nuevo León.
-- Do not change stored historical rides or their actual pickup/dropoff locations.
-- Unique v2 RPC names avoid PostgREST overload ambiguity. The existing RPCs stay
-- callable by older clients and delegate to campus-scope lookup.

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
    on pts.stop_id = ps.transport_stop_id and pts.active
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
    join public.transport_stops pts on pts.stop_id = ps.transport_stop_id and pts.active
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
    where ts.active
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

revoke all on function public.get_passenger_stop_candidates_v2(double precision, double precision, double precision, double precision, integer, text) from public, anon, authenticated;
grant execute on function public.get_passenger_stop_candidates_v2(double precision, double precision, double precision, double precision, integer, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_passenger_stop_candidates(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_max_distance_m integer DEFAULT 1000)
 RETURNS TABLE(stop_role text, stop_id uuid, external_id text, stop_name text, stop_address text, municipality text, stop_type text, lat numeric, lng numeric, distance_m double precision, enabled boolean, ride_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  return query select * from public.get_passenger_stop_candidates_v2(
    p_origin_lat, p_origin_lng, p_destination_lat, p_destination_lng,
    p_max_distance_m, 'campus'
  );
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
    on pts.stop_id = ps.transport_stop_id and pts.active
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

revoke all on function public.get_passenger_stop_pairs_v2(double precision, double precision, double precision, double precision, integer, text) from public, anon, authenticated;
grant execute on function public.get_passenger_stop_pairs_v2(double precision, double precision, double precision, double precision, integer, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_passenger_stop_pairs(p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_max_distance_m integer DEFAULT 1000)
 RETURNS TABLE(pickup_transport_stop_id uuid, dropoff_transport_stop_id uuid, ride_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  return query select * from public.get_passenger_stop_pairs_v2(
    p_origin_lat, p_origin_lng, p_destination_lat, p_destination_lng,
    p_max_distance_m, 'campus'
  );
end;
$function$;

-- Keep the same read API principals on the compatibility entry points.
revoke all on function public.get_passenger_stop_candidates(double precision, double precision, double precision, double precision, integer) from public, anon;
revoke all on function public.get_passenger_stop_pairs(double precision, double precision, double precision, double precision, integer) from public, anon;
revoke all on function public.search_available_rides_v2(double precision, double precision, double precision, double precision, integer, timestamp with time zone, timestamp with time zone, integer) from public, anon;
revoke all on function public.search_available_rides_by_stops(double precision, double precision, double precision, double precision, uuid, uuid, integer, timestamp with time zone, timestamp with time zone, integer) from public, anon;

notify pgrst, 'reload schema';
