-- Reviewed export from schema-audit-20261006.json. Test fixture only.
CREATE OR REPLACE FUNCTION public.request_booking_v2(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_booking_id uuid;
  v_pickup public.ride_stops%rowtype;
  v_dropoff public.ride_stops%rowtype;
  v_seats integer;
begin
  if v_actor is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from public.users u where u.uuid = v_actor) then
    raise exception 'Perfil de usuario no encontrado';
  end if;
  select * into v_ride
  from public.rides r
  where r.ride_id = (p_payload->>'ride_id')::uuid
  for update;
  if not found then raise exception 'El viaje no existe'; end if;
  if v_ride.status <> 'scheduled' then
    raise exception 'El viaje no acepta reservaciones';
  end if;
  if exists (
    select 1 from public.driver_profiles dp
    where dp.driver_id = v_ride.driver_id and dp.user_id = v_actor
  ) then
    raise exception 'No puedes reservar tu propio viaje';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.user_id = v_actor
      and b.status in ('pending', 'confirmed', 'in_progress')
  ) then
    raise exception 'Ya tienes una reservacion activa';
  end if;
  v_seats := coalesce((p_payload->>'seats_reserved')::integer, 1);
  if v_seats < 1 or v_seats > v_ride.available_seats then
    raise exception 'No hay suficientes asientos disponibles';
  end if;
  select * into v_pickup from public.ride_stops rs
  where rs.stop_id = (p_payload->>'pickup_stop_id')::uuid
    and rs.ride_id = v_ride.ride_id and rs.is_active
    and rs.route_version = v_ride.version;
  select * into v_dropoff from public.ride_stops rs
  where rs.stop_id = (p_payload->>'dropoff_stop_id')::uuid
    and rs.ride_id = v_ride.ride_id and rs.is_active
    and rs.route_version = v_ride.version;
  if v_pickup.stop_id is null or v_dropoff.stop_id is null then
    raise exception 'Las paradas seleccionadas no son validas';
  end if;
  if v_pickup.transport_stop_id is null
     or v_dropoff.transport_stop_id is null
     or v_pickup.stop_order >= v_dropoff.stop_order then
    raise exception 'La parada de bajada debe estar despues de la subida';
  end if;
  insert into public.bookings (
    ride_id, user_id, pickup_stop_id, dropoff_stop_id,
    seats_reserved, status
  ) values (
    v_ride.ride_id, v_actor, v_pickup.stop_id, v_dropoff.stop_id,
    v_seats, 'pending'
  ) returning booking_id into v_booking_id;
  return v_booking_id;
end;
$function$;
