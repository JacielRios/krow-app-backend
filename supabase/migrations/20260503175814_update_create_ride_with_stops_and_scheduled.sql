create or replace function public.create_ride(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Origen (stop_order = 1) y destino (stop_order = 2) a nivel de ride.
  -- Las bookings de pasajeros referencian estos stops, en lugar de crear stops nuevos por reserva.
  insert into public.ride_stops (ride_id, lat, lng, address, stop_order)
  values (v_ride_id, v_origin_lat, v_origin_lng, coalesce(v_origin_addr, ''), 1);

  insert into public.ride_stops (ride_id, lat, lng, address, stop_order)
  values (v_ride_id, v_dest_lat, v_dest_lng, coalesce(v_dest_addr, ''), 2);

  insert into public.ride_status_history (ride_id, status)
  values (v_ride_id, 'scheduled');

  return v_ride_id;
end;
$function$;
