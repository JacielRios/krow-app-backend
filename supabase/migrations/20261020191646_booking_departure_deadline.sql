begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Recheck at INSERT, after the RPC acquired its ride lock. A cached search
-- result must not authorize a new reservation after departure.
create or replace function private.validate_booking_departure()
returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_departure timestamptz;
begin
  if new.status in ('pending', 'confirmed') then
    select departure_time into v_departure
    from public.rides where ride_id = new.ride_id for share;
    if v_departure is null or v_departure <= clock_timestamp() then
      raise exception 'El viaje no acepta reservaciones: la hora de salida ya pasó';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_booking_departure()
  from public, anon, authenticated;

create trigger bookings_validate_departure
before insert on public.bookings
for each row execute function private.validate_booking_departure();

commit;
