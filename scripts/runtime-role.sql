-- Run after the additive migration, as database owner, once per environment.
-- This is a NOLOGIN privilege group. Create a separate login/password in your
-- secret-management workflow and grant this role to that login; never use postgres.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='krow_runtime_service') then
    create role krow_runtime_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema public,krow_runtime to krow_runtime_service;
grant select on public.rides,public.bookings,public.ride_stops,public.driver_profiles,public.transport_stops to krow_runtime_service;
grant update(status) on public.rides to krow_runtime_service;
grant insert,update(status) on public.bookings to krow_runtime_service;
grant insert on public.ride_status_history to krow_runtime_service;
grant select,insert,update,delete on all tables in schema krow_runtime to krow_runtime_service;
grant usage,select on all sequences in schema krow_runtime to krow_runtime_service;
do $$ declare t text; begin
  foreach t in array array['rides','bookings','ride_stops','driver_profiles','transport_stops'] loop
    execute format('drop policy if exists runtime_service_select on public.%I',t);
    execute format('create policy runtime_service_select on public.%I for select to krow_runtime_service using (true)',t);
  end loop;
  foreach t in array array['rides','bookings'] loop
    execute format('drop policy if exists runtime_service_update on public.%I',t);
    execute format('create policy runtime_service_update on public.%I for update to krow_runtime_service using (true) with check (true)',t);
  end loop;
  foreach t in array array['bookings','ride_status_history'] loop
    execute format('drop policy if exists runtime_service_insert on public.%I',t);
    execute format('create policy runtime_service_insert on public.%I for insert to krow_runtime_service with check (true)',t);
  end loop;
  for t in select tablename from pg_tables where schemaname='krow_runtime' loop
    execute format('drop policy if exists runtime_service_access on krow_runtime.%I',t);
    execute format('create policy runtime_service_access on krow_runtime.%I to krow_runtime_service using (true) with check (true)',t);
  end loop;
end $$;
commit;
