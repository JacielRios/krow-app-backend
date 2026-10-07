-- request_booking: pasajero crea reserva pending atomicamente con sus stops
create or replace function public.request_booking(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id        uuid;
  v_ride_id        uuid;
  v_seats          int;
  v_pickup_lat     numeric;
  v_pickup_lng     numeric;
  v_dropoff_lat    numeric;
  v_dropoff_lng    numeric;
  v_pickup_addr    text;
  v_dropoff_addr   text;
  v_ride           rides%rowtype;
  v_pickup_stop    uuid;
  v_dropoff_stop   uuid;
  v_booking_id     uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  v_ride_id      := (p_payload->>'ride_id')::uuid;
  v_seats        := coalesce((p_payload->>'seats_reserved')::int, 1);
  v_pickup_lat   := (p_payload->>'pickup_lat')::numeric;
  v_pickup_lng   := (p_payload->>'pickup_lng')::numeric;
  v_dropoff_lat  := (p_payload->>'dropoff_lat')::numeric;
  v_dropoff_lng  := (p_payload->>'dropoff_lng')::numeric;
  v_pickup_addr  := nullif(p_payload->>'pickup_address', '');
  v_dropoff_addr := nullif(p_payload->>'dropoff_address', '');

  if v_ride_id is null then
    raise exception 'ride_id es obligatorio';
  end if;
  if v_seats < 1 then
    raise exception 'Debe reservar al menos 1 asiento';
  end if;
  if v_pickup_lat is null or v_pickup_lng is null or v_dropoff_lat is null or v_dropoff_lng is null then
    raise exception 'Las coordenadas de origen y destino son obligatorias';
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

  if exists (
    select 1 from bookings b
    where b.ride_id = v_ride_id
      and b.user_id = v_user_id
      and b.status in ('pending', 'confirmed')
  ) then
    raise exception 'Ya tienes una reserva activa para este viaje';
  end if;

  insert into ride_stops (ride_id, lat, lng, address, stop_order)
  values (v_ride_id, v_pickup_lat, v_pickup_lng, coalesce(v_pickup_addr, ''), 1)
  returning stop_id into v_pickup_stop;

  insert into ride_stops (ride_id, lat, lng, address, stop_order)
  values (v_ride_id, v_dropoff_lat, v_dropoff_lng, coalesce(v_dropoff_addr, ''), 2)
  returning stop_id into v_dropoff_stop;

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
$$;

grant execute on function public.request_booking(jsonb) to authenticated;

-- update_booking_status: conductor confirma o cancela; pasajero solo cancela
create or replace function public.update_booking_status(
  p_booking_id uuid,
  p_new_status text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id    uuid;
  v_booking    bookings%rowtype;
  v_ride       rides%rowtype;
  v_is_driver  boolean;
  v_is_owner   boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  if p_new_status not in ('confirmed', 'cancelled') then
    raise exception 'Estado invalido';
  end if;

  select * into v_booking from bookings where booking_id = p_booking_id for update;
  if not found then
    raise exception 'La reserva no existe';
  end if;

  select * into v_ride from rides where ride_id = v_booking.ride_id for update;

  v_is_driver := exists (
    select 1 from driver_profiles dp
    where dp.driver_id = v_ride.driver_id
      and dp.user_id   = v_user_id
  );
  v_is_owner := v_booking.user_id = v_user_id;

  if not (v_is_driver or v_is_owner) then
    raise exception 'No tienes permiso para modificar esta reserva';
  end if;

  if p_new_status = 'confirmed' then
    if not v_is_driver then
      raise exception 'Solo el conductor puede confirmar la reserva';
    end if;
    if v_booking.status <> 'pending' then
      raise exception 'Solo se pueden confirmar reservas pendientes';
    end if;
    if v_ride.available_seats < v_booking.seats_reserved then
      raise exception 'Ya no hay suficientes asientos disponibles';
    end if;

    update bookings set status = 'confirmed' where booking_id = p_booking_id;
    update rides
       set available_seats = available_seats - v_booking.seats_reserved
     where ride_id = v_booking.ride_id;
  elsif p_new_status = 'cancelled' then
    if v_booking.status = 'cancelled' then
      raise exception 'La reserva ya esta cancelada';
    end if;
    if v_booking.status = 'confirmed' then
      update rides
         set available_seats = available_seats + v_booking.seats_reserved
       where ride_id = v_booking.ride_id;
    end if;
    update bookings set status = 'cancelled' where booking_id = p_booking_id;
  end if;
end;
$$;

grant execute on function public.update_booking_status(uuid, text) to authenticated;
