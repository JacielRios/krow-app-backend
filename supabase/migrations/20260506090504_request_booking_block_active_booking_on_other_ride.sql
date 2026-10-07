CREATE OR REPLACE FUNCTION public.request_booking(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id        uuid;
  v_ride_id        uuid;
  v_seats          int;
  v_ride           rides%rowtype;
  v_pickup_stop    uuid;
  v_dropoff_stop   uuid;
  v_booking_id     uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  v_ride_id := (p_payload->>'ride_id')::uuid;
  v_seats   := coalesce((p_payload->>'seats_reserved')::int, 1);

  if v_ride_id is null then
    raise exception 'ride_id es obligatorio';
  end if;
  if v_seats < 1 then
    raise exception 'Debe reservar al menos 1 asiento';
  end if;

  select * into v_ride from rides where ride_id = v_ride_id for update;
  if not found then
    raise exception 'El viaje no existe';
  end if;

  if v_ride.status <> 'scheduled' then
    raise exception 'El viaje ya no esta disponible para reserva';
  end if;
  if v_ride.departure_time <= now() then
    raise exception 'El viaje ya partio';
  end if;
  if v_ride.available_seats < v_seats then
    raise exception 'No hay suficientes asientos disponibles';
  end if;

  if exists (
    select 1 from driver_profiles dp
    where dp.driver_id = v_ride.driver_id
      and dp.user_id   = v_user_id
  ) then
    raise exception 'No puedes reservar tu propio viaje';
  end if;

  -- Verificar que el pasajero no tenga ya un booking activo en cualquier ride
  if exists (
    select 1 from bookings
    where user_id = auth.uid()
      and status = any(array['pending', 'confirmed', 'in_progress'])
  ) then
    raise exception 'Ya tienes una reserva activa en otro viaje';
  end if;

  if exists (
    select 1 from bookings b
    where b.ride_id = v_ride_id
      and b.user_id = v_user_id
      and b.status in ('pending', 'confirmed')
  ) then
    raise exception 'Ya tienes una reserva activa para este viaje';
  end if;

  select stop_id into v_pickup_stop
  from ride_stops
  where ride_id = v_ride_id and stop_order = 1
  limit 1;

  select stop_id into v_dropoff_stop
  from ride_stops
  where ride_id = v_ride_id and stop_order = 2
  limit 1;

  if v_pickup_stop is null or v_dropoff_stop is null then
    raise exception 'El viaje no tiene paradas de origen y destino configuradas';
  end if;

  insert into bookings (
    ride_id, user_id, pickup_stop_id, dropoff_stop_id,
    seats_reserved, status
  ) values (
    v_ride_id, v_user_id, v_pickup_stop, v_dropoff_stop,
    v_seats, 'pending'
  )
  returning booking_id into v_booking_id;

  return v_booking_id;
end;
$function$;
