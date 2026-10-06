create or replace function public.get_passenger_stop_pairs(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_max_distance_m integer default 1000
)
returns table (
  pickup_transport_stop_id uuid,
  dropoff_transport_stop_id uuid,
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
    and extensions.st_dwithin(ps.location, v_origin, p_max_distance_m)
    and extensions.st_dwithin(ds.location, v_destination, p_max_distance_m)
  group by ps.transport_stop_id, ds.transport_stop_id
  order by count(distinct r.ride_id) desc,
    ps.transport_stop_id, ds.transport_stop_id;
end;
$$;

revoke all on function public.get_passenger_stop_pairs(
  double precision, double precision, double precision, double precision, integer
) from public, anon;
grant execute on function public.get_passenger_stop_pairs(
  double precision, double precision, double precision, double precision, integer
) to authenticated;
