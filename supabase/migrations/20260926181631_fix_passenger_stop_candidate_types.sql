-- Correct the coordinate casts found during live RPC verification.
create or replace function public.get_passenger_stop_candidates(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_max_distance_m integer default 1000
)
returns table (
  stop_role text,
  stop_id uuid,
  external_id text,
  stop_name text,
  stop_address text,
  municipality text,
  stop_type text,
  lat numeric,
  lng numeric,
  distance_m double precision,
  enabled boolean,
  ride_count bigint
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
  with candidates as (
    select 'pickup'::text as candidate_role, ts.*,
      extensions.st_distance(ts.location, v_origin) as candidate_distance
    from public.transport_stops ts
    where ts.active
      and extensions.st_dwithin(ts.location, v_origin, p_max_distance_m)
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
              and extensions.st_dwithin(
                counterpart.location, v_origin, p_max_distance_m
              )
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
$$;

revoke all on function public.get_passenger_stop_candidates(
  double precision, double precision, double precision, double precision, integer
) from public, anon;
grant execute on function public.get_passenger_stop_candidates(
  double precision, double precision, double precision, double precision, integer
) to authenticated;
