create or replace function public.get_my_passenger_rides(p_limit integer default 10)
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  return query
  (
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
      coalesce(b.seats_reserved, 0) as available_seats,
      r.price_per_seat
    from public.bookings b
    join public.rides r on r.ride_id = b.ride_id
    where b.user_id = v_user_id
      and r.status in ('scheduled', 'open', 'full', 'in_progress')
    order by r.departure_time asc
    limit p_limit
  )
  union all
  (
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
      coalesce(b.seats_reserved, 0) as available_seats,
      r.price_per_seat
    from public.bookings b
    join public.rides r on r.ride_id = b.ride_id
    where b.user_id = v_user_id
      and r.status in ('completed', 'cancelled')
    order by r.departure_time desc
    limit p_limit
  );
end;
$$;

revoke execute on function public.get_my_passenger_rides(integer) from anon, public;
grant execute on function public.get_my_passenger_rides(integer) to authenticated;
