alter table public.rides
  add column if not exists origin_address text,
  add column if not exists destination_address text,
  add column if not exists route_polyline text;

comment on column public.rides.origin_address is 'Direccion legible del origen (Google Places formatted_address)';
comment on column public.rides.destination_address is 'Direccion legible del destino (Google Places formatted_address)';
comment on column public.rides.route_polyline is 'Polyline encoded de Google Directions API (overview_polyline.points)';

-- Recreate create_ride para aceptar los nuevos campos (todos opcionales)
create or replace function public.create_ride(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id     uuid;
  v_driver_id   uuid;
  v_vehicle_id  uuid;
  v_departure   timestamptz;
  v_seats       int;
  v_price       numeric;
  v_origin_lat  numeric;
  v_origin_lng  numeric;
  v_dest_lat    numeric;
  v_dest_lng    numeric;
  v_origin_addr text;
  v_dest_addr   text;
  v_polyline    text;
  v_ride_id     uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select driver_id into v_driver_id
  from public.driver_profiles
  where user_id = v_user_id
    and status  = 'approved'
  limit 1;

  if v_driver_id is null then
    raise exception 'El usuario no tiene perfil de conductor aprobado';
  end if;

  v_vehicle_id := (p_payload->>'vehicle_id')::uuid;
  v_departure  := (p_payload->>'departure_time')::timestamptz;
  v_seats      := (p_payload->>'available_seats')::int;
  v_price      := (p_payload->>'price_per_seat')::numeric;
  v_origin_lat := (p_payload->>'origin_lat')::numeric;
  v_origin_lng := (p_payload->>'origin_lng')::numeric;
  v_dest_lat   := (p_payload->>'destination_lat')::numeric;
  v_dest_lng   := (p_payload->>'destination_lng')::numeric;
  v_origin_addr := nullif(p_payload->>'origin_address', '');
  v_dest_addr   := nullif(p_payload->>'destination_address', '');
  v_polyline    := nullif(p_payload->>'route_polyline', '');

  if not exists (
    select 1 from public.vehicles
    where vehicle_id = v_vehicle_id
      and driver_id  = v_driver_id
      and is_active  = true
  ) then
    raise exception 'El vehiculo no existe o no pertenece al conductor';
  end if;

  if v_departure <= now() then
    raise exception 'La hora de salida debe ser en el futuro';
  end if;

  if v_seats < 1 then
    raise exception 'Debe haber al menos 1 asiento disponible al crear el viaje';
  end if;

  if v_price <= 0 then
    raise exception 'El precio por asiento debe ser mayor a 0';
  end if;

  insert into public.rides (
    driver_id,
    vehicle_id,
    origin_lat,
    origin_lng,
    destination_lat,
    destination_lng,
    origin_address,
    destination_address,
    route_polyline,
    departure_time,
    available_seats,
    price_per_seat
  )
  values (
    v_driver_id,
    v_vehicle_id,
    v_origin_lat,
    v_origin_lng,
    v_dest_lat,
    v_dest_lng,
    v_origin_addr,
    v_dest_addr,
    v_polyline,
    v_departure,
    v_seats,
    v_price
  )
  returning ride_id into v_ride_id;

  insert into public.ride_status_history (ride_id, status)
  values (v_ride_id, 'created');

  return v_ride_id;
end;
$$;

grant execute on function public.create_ride(jsonb) to authenticated;

-- Recreate search_available_rides incluyendo direcciones y polyline
drop function if exists public.search_available_rides(int, timestamptz, timestamptz);

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
  origin_address text,
  destination_address text,
  route_polyline text,
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
    r.origin_address,
    r.destination_address,
    r.route_polyline,
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
    and not exists (
      select 1 from driver_profiles dpme
      where dpme.driver_id = r.driver_id
        and dpme.user_id   = auth.uid()
    )
  order by r.departure_time asc
  limit greatest(coalesce(p_max_results, 50), 1);
$$;

grant execute on function public.search_available_rides(int, timestamptz, timestamptz) to authenticated;
