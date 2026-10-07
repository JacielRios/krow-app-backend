-- Apply as migration owner. Assign a separately managed LOGIN to this group.
-- Never give the API a superuser, database-owner or Supabase service-role login.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='krow_pilot_service') then
    create role krow_pilot_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema public,krow_pilot to krow_pilot_service;
grant select on public.users,public.driver_profiles,public.vehicles,public.rides,public.bookings,public.ride_stops to krow_pilot_service;
grant update(status,version,updated_at,available_seats) on public.rides to krow_pilot_service;
grant update(status) on public.bookings to krow_pilot_service;
grant update(rating) on public.users,public.driver_profiles to krow_pilot_service;
grant update(is_active) on public.users to krow_pilot_service;
grant insert(uuid,email_address,full_name,institutional_id,academic_program,academic_period),
  update(email_address,full_name,institutional_id,academic_program,academic_period)
  on public.users to krow_pilot_service;
drop policy if exists krow_pilot_user_insert on public.users;
create policy krow_pilot_user_insert on public.users for insert to krow_pilot_service with check(true);
grant select,insert on public.ride_reviews to krow_pilot_service;
drop policy if exists pilot_service_reviews on public.ride_reviews;
create policy pilot_service_reviews on public.ride_reviews for select to krow_pilot_service using(true);
drop policy if exists pilot_service_review_insert on public.ride_reviews;
create policy pilot_service_review_insert on public.ride_reviews for insert to krow_pilot_service with check(true);
grant select,insert,update,delete on all tables in schema krow_pilot to krow_pilot_service;
grant execute on function public.create_ride_v2(jsonb),public.update_ride_v2(uuid,integer,jsonb),public.upsert_favorite_route(jsonb),public.request_booking_v2(jsonb),public.delete_favorite_route(uuid) to krow_pilot_service;
grant insert on public.ride_status_history to krow_pilot_service;
do $$ declare s text; begin
  s:=pg_get_serial_sequence('public.ride_status_history','id');
  if s is not null then execute format('grant usage on sequence %s to krow_pilot_service',s); end if;
  s:=pg_get_serial_sequence('public.users','id');
  if s is not null then execute format('grant usage on sequence %s to krow_pilot_service',s); end if;
end $$;
drop policy if exists pilot_service_history on public.ride_status_history;
create policy pilot_service_history on public.ride_status_history for insert to krow_pilot_service with check(true);
do $$ declare t text; begin
  foreach t in array array['users','driver_profiles','vehicles','rides','bookings','ride_stops'] loop
    execute format('drop policy if exists pilot_service_select on public.%I',t);
    execute format('create policy pilot_service_select on public.%I for select to krow_pilot_service using(true)',t);
  end loop;
  foreach t in array array['rides','bookings','users','driver_profiles'] loop
    execute format('drop policy if exists pilot_service_update on public.%I',t);
    execute format('create policy pilot_service_update on public.%I for update to krow_pilot_service using(true) with check(true)',t);
  end loop;
  for t in select tablename from pg_tables where schemaname='krow_pilot' loop
    execute format('drop policy if exists pilot_service_access on krow_pilot.%I',t);
    execute format('create policy pilot_service_access on krow_pilot.%I to krow_pilot_service using(true) with check(true)',t);
  end loop;
end $$;
commit;
