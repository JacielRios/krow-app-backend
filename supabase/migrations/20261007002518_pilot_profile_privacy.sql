-- Deploy with the pilot API's private /me and participant views. A mobile
-- client must not read another traveller's email or academic identifiers.
-- Full account fields are served only after API identity/ownership checks.
revoke select on public.users from public, anon, authenticated;
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum)
    into columns_sql
    from pg_attribute
    where attrelid = 'public.users'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%s) on public.users from public, anon, authenticated', columns_sql);
end $$;
grant select (uuid, full_name, profile_photo, rating) on public.users to authenticated;
drop policy if exists users_select_coplanners on public.users;
-- Keep the existing own-account policy; participant cards are returned by
-- the API, which exposes only the fields necessary for that reservation.

-- RLS does not protect TRUNCATE or REFERENCES. Neither these privileges nor
-- permission to create triggers is needed by an untrusted app client.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users', 'driver_profiles', 'vehicles', 'rides', 'ride_stops',
    'bookings', 'favorite_routes', 'favorite_route_stops', 'transport_stops',
    'ride_reviews', 'ride_status_history', 'chats', 'chat_messages',
    'payment_methods', 'payments'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('revoke truncate, references, trigger on public.%I from public, anon, authenticated', table_name);
    end if;
  end loop;
end $$;
