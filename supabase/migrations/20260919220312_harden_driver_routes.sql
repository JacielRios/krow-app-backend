-- Route and booking mutations must pass through the transactional RPCs.
-- Existing and new mobile clients use the NestJS API, never direct table writes.
revoke insert, update, delete on public.rides, public.ride_stops,
  public.bookings from anon, authenticated;

-- The prior schema already had idx_bookings_ride_status with these columns.
drop index if exists public.bookings_ride_status_idx;

create index if not exists chat_messages_sender_id_idx
  on public.chat_messages (sender_id);
create index if not exists payments_payment_method_id_idx
  on public.payments (payment_method_id);
create index if not exists ride_reviews_reviewer_id_idx
  on public.ride_reviews (reviewer_id);
create index if not exists ride_status_history_actor_id_idx
  on public.ride_status_history (actor_id);

-- Deactivated catalog stops must immediately disappear from matching and
-- stop options for already-published rides. Existing bookings remain intact.
create or replace function private.deactivate_catalog_ride_stops()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.active and not new.active then
    update public.ride_stops
    set is_active = false
    where transport_stop_id = new.stop_id and is_active;
  end if;
  return new;
end;
$$;
revoke all on function private.deactivate_catalog_ride_stops()
  from public, anon, authenticated;

create trigger transport_stops_deactivate_rides
after update of active on public.transport_stops
for each row execute function private.deactivate_catalog_ride_stops();

-- An RPC is not the only possible writer (e.g. a privileged maintenance job).
-- Keep the catalog and stop-order invariant at the database boundary too.
create or replace function private.validate_catalog_booking_stops()
returns trigger
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.validate_catalog_booking_stops()
  from public, anon, authenticated;

create trigger bookings_validate_catalog_stops
before insert or update of pickup_stop_id, dropoff_stop_id, ride_id
on public.bookings
for each row execute function private.validate_catalog_booking_stops();
