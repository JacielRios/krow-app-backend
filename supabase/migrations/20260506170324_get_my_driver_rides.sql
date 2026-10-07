-- Lista viajes del conductor autenticado (misma lógica que usa el home).
-- security definer: bypass RLS como el resto de RPCs de ciclo de vida.

create or replace function public.get_my_driver_rides(p_limit integer default 10)
returns table (
  ride_id uuid,
  status text,
  departure_time timestamptz,
  origin_lat numeric,
  origin_lng numeric,
  destination_lat numeric,
  destination_lng numeric,
  origin_address text,
  destination_address text,
  available_seats integer,
  price_per_seat numeric
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_driver_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select dp.driver_id into v_driver_id
  from public.driver_profiles dp
  where dp.user_id = v_user_id
    and dp.status = 'approved'
  limit 1;

  if v_driver_id is null then
    return;
  end if;

  return query
  select
    r.ride_id,
    r.status,
    r.departure_time,
    r.origin_lat,
    r.origin_lng,
    r.destination_lat,
    r.destination_lng,
    r.origin_address,
    r.destination_address,
    r.available_seats,
    r.price_per_seat
  from public.rides r
  where r.driver_id = v_driver_id
  order by r.departure_time desc
  limit p_limit;
end;
$$;

revoke execute on function public.get_my_driver_rides(integer) from anon, public;
grant execute on function public.get_my_driver_rides(integer) to authenticated;
