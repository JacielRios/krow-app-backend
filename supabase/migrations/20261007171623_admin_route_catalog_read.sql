begin;
set local lock_timeout='5s';
-- Historical route details join catalog identifiers/names only. The private API
-- did not inherit authenticated's catalog policy. Keep this read specific to a
-- verified administrator and do not add catalog write or broad column access.
grant select(stop_id,name) on public.transport_stops to krow_pilot_service;
create policy admin_route_catalog_read on public.transport_stops for select
to krow_pilot_service using((select private.is_admin_actor()));
commit;
