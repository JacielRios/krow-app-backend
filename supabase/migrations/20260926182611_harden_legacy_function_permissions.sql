-- Trigger functions must never be callable through the Data API.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;
revoke execute on function public.update_user_rating_on_review()
  from public, anon, authenticated;

-- These RPCs are application endpoints for signed-in users only.
revoke execute on function public.get_driver_card(uuid) from public, anon;
grant execute on function public.get_driver_card(uuid) to authenticated;
revoke execute on function public.submit_review(uuid, uuid, smallint, text)
  from public, anon;
grant execute on function public.submit_review(uuid, uuid, smallint, text)
  to authenticated;

-- Pin the lookup path of legacy privileged routines. Their existing bodies use
-- public and PostGIS objects, so both schemas are explicit and deterministic.
alter function public.validate_booking_transition(text, text)
  set search_path = public, extensions;
alter function public.update_user_rating_on_review()
  set search_path = public, extensions;
alter function public.complete_ride(uuid)
  set search_path = public, extensions;
alter function public.submit_review(uuid, uuid, smallint, text)
  set search_path = public, extensions;
alter function public.validate_ride_transition(text, text)
  set search_path = public, extensions;
alter function public.handle_new_user()
  set search_path = public, extensions;
