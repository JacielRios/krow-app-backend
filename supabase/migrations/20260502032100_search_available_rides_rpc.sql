create or replace function public.search_available_rides(
  p_max_results int default 50,
  p_from_time timestamptz default null,
  p_to_time timestamptz default null
)
returns table (
  ride_id uuid,
  driver_id uuid,
  driver_user_id uuid,
  driver_name text,
  driver_rating numeric,
  vehicle_id uuid,
  vehicle_brand text,
  vehicle_model text,
  vehicle_plate text,
  vehicle_color text,
  origin_lat numeric,
  origin_lng numeric,
  destination_lat numeric,
  destination_lng numeric,
  departure_time timestamptz,
  available_seats int,
  price_per_seat numeric,
  status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    r.ride_id,
    r.driver_id,
    dp.user_id            as driver_user_id,
    u.full_name           as driver_name,
    coalesce(dp.rating, u.rating) as driver_rating,
    v.vehicle_id,
    v.brand               as vehicle_brand,
    v.model               as vehicle_model,
    v.license_plate       as vehicle_plate,
    v.car_color           as vehicle_color,
    r.origin_lat,
    r.origin_lng,
    r.destination_lat,
    r.destination_lng,
    r.departure_time,
    r.available_seats,
    r.price_per_seat,
    r.status
  from rides r
  join driver_profiles dp on dp.driver_id = r.driver_id
  left join users u  on u.uuid = dp.user_id
  left join vehicles v on v.vehicle_id = r.vehicle_id
  where r.status = 'scheduled'
    and r.available_seats > 0
    and r.departure_time > coalesce(p_from_time, now())
    and (p_to_time is null or r.departure_time <= p_to_time)
    -- excluir los rides del propio conductor solicitante
    and not exists (
      select 1 from driver_profiles dpme
      where dpme.driver_id = r.driver_id
        and dpme.user_id   = auth.uid()
    )
  order by r.departure_time asc
  limit greatest(coalesce(p_max_results, 50), 1);
$$;

grant execute on function public.search_available_rides(int, timestamptz, timestamptz) to authenticated;
