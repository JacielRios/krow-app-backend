-- Read-only metadata audit of public rides/bookings triggers, 2026-10-06.
-- Synthetic test dependencies live in pilot-baseline.sql; no production data.
create schema if not exists private;
CREATE OR REPLACE FUNCTION private.validate_catalog_booking_stops()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version integer;
  v_pickup_order integer;
  v_dropoff_order integer;
begin
  select r.version into v_version
  from public.rides r
  where r.ride_id = new.ride_id and r.route_provider is not null;

  -- Historical rides may still use their original non-catalog stops.
  if v_version is null then return new; end if;

  select rs.stop_order into v_pickup_order
  from public.ride_stops rs
  join public.transport_stops ts
    on ts.stop_id = rs.transport_stop_id and ts.active
  where rs.stop_id = new.pickup_stop_id
    and rs.ride_id = new.ride_id
    and rs.route_version = v_version and rs.is_active
  for share of ts;

  select rs.stop_order into v_dropoff_order
  from public.ride_stops rs
  join public.transport_stops ts
    on ts.stop_id = rs.transport_stop_id and ts.active
  where rs.stop_id = new.dropoff_stop_id
    and rs.ride_id = new.ride_id
    and rs.route_version = v_version and rs.is_active
  for share of ts;

  if v_pickup_order is null or v_dropoff_order is null
     or v_pickup_order >= v_dropoff_order then
    raise exception 'Las paradas de la reserva no están activas u ordenadas';
  end if;
  return new;
end;
$function$;
CREATE TRIGGER bookings_validate_catalog_stops BEFORE INSERT OR UPDATE OF pickup_stop_id, dropoff_stop_id, ride_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.validate_catalog_booking_stops();
CREATE OR REPLACE FUNCTION public.validate_booking_stops_same_ride()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.ride_stops ps
    join public.ride_stops ds on ds.stop_id = new.dropoff_stop_id
    where ps.stop_id = new.pickup_stop_id
      and ps.ride_id = new.ride_id
      and ds.ride_id = new.ride_id
  ) then
    raise exception 'Pickup and dropoff stops must belong to the booking ride';
  end if;

  return new;
end;
$function$;
CREATE TRIGGER bookings_validate_stops_same_ride BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION validate_booking_stops_same_ride();
CREATE OR REPLACE FUNCTION public.validate_ride_vehicle_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.vehicles v
    where v.vehicle_id = new.vehicle_id
      and v.driver_id = new.driver_id
  ) then
    raise exception 'The selected vehicle does not belong to the driver';
  end if;

  return new;
end;
$function$;
CREATE TRIGGER rides_validate_vehicle_driver BEFORE INSERT OR UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION validate_ride_vehicle_driver();
