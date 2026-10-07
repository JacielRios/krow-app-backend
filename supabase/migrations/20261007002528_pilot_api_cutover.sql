-- Apply only when the private pilot API is configured and ready to take traffic.
-- This preserves the authenticated actor in RPCs while making the API the
-- only business writer. Old API/mobile versions cannot write after this step.
begin;
set local lock_timeout = '5s';
do $$ declare f regprocedure; t text; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
    ('create_ride','create_ride_v2','update_ride_v2','upsert_favorite_route','delete_favorite_route',
     'request_booking','request_booking_v2','update_booking_status',
     'start_ride','cancel_ride','complete_ride','complete_stop','submit_review') loop
    execute format('revoke execute on function %s from public,anon,authenticated',f);
  end loop;
  foreach t in array array['rides','bookings','ride_stops','favorite_routes','ride_reviews','driver_profiles','vehicles','users'] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
    end if;
  end loop;
end $$;
-- Profile edits cannot change approval, reputation or account closure.
grant insert(uuid,email_address,full_name,institutional_id,academic_program,academic_period,profile_photo),
  update(uuid,email_address,full_name,institutional_id,academic_program,academic_period,profile_photo)
  on public.users to authenticated;
commit;
