-- Cover FK lookups used for cleanup, ownership and administrative joins.
create index if not exists audit_log_actor_idx on krow_admin.audit_log(actor_id);
create index if not exists documents_created_by_idx on krow_admin.documents(created_by);
create index if not exists documents_reviewed_by_idx on krow_admin.documents(reviewed_by);
create index if not exists cash_collected_by_idx on krow_pilot.cash(collected_by);
create index if not exists devices_actor_idx on krow_pilot.devices(actor_id);
create index if not exists messages_sender_idx on krow_pilot.messages(sender_id);
create index if not exists outbox_booking_idx on krow_pilot.outbox(booking_id);
create index if not exists outbox_recipient_idx on krow_pilot.outbox(recipient_id);
create index if not exists outbox_ride_idx on krow_pilot.outbox(ride_id);
create index if not exists reviews_author_idx on krow_pilot.reviews(author_id);
create index if not exists tracking_sessions_actor_idx on krow_pilot.tracking_sessions(actor_id);
create index if not exists incidents_actor_idx on krow_pilot.incidents(actor_id);
create index if not exists incidents_handler_idx on krow_pilot.incidents(handled_by);
drop index if exists public.pilot_reviews_subject;
