begin;
set local lock_timeout = '5s';

-- Additive metadata only: existing identities, trips, reservations and money
-- remain in the current business tables. Driver suspension does not close the
-- user's passenger account or stop an ongoing trip's GPS.
alter table public.driver_profiles add column admin_status text;
update public.driver_profiles set admin_status=case status when 'approved' then 'active' when 'suspended' then 'suspended' else 'inactive' end;
alter table public.driver_profiles alter column admin_status set not null, alter column admin_status set default 'inactive';
alter table public.driver_profiles add constraint driver_admin_status_check check(admin_status in('active','suspended','inactive'));
alter table public.vehicles add column admin_status text;
update public.vehicles set admin_status=case when is_active then 'active' else 'inactive' end;
alter table public.vehicles alter column admin_status set not null, alter column admin_status set default 'active';
alter table public.vehicles add constraint vehicle_admin_status_check check(admin_status in('active','suspended','inactive'));

-- Auth claims can be stale after an administrator is demoted. This lookup is
-- private, takes no caller-controlled identity, and reveals only own eligibility.
create or replace function private.is_admin_actor() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from auth.users a where a.id=auth.uid() and a.raw_app_meta_data->>'role'='admin'
    and exists(select 1 from public.users u where u.uuid=a.id and u.is_active is distinct from false and u.deleted_at is null)
  )
$$;
revoke all on function private.is_admin_actor() from public,anon,authenticated;
grant usage on schema private to authenticated,krow_pilot_service;
grant execute on function private.is_admin_actor() to authenticated,krow_pilot_service;

create schema krow_admin;
revoke all on schema krow_admin from public,anon,authenticated;
grant usage on schema krow_admin to krow_pilot_service;
create table krow_admin.documents(
  document_id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.driver_profiles(driver_id) on delete restrict,
  vehicle_id uuid references public.vehicles(vehicle_id) on delete restrict,
  kind text not null check(kind in('license','identity','registration','insurance','other')),
  status text not null default 'pending' check(status in('pending','approved','rejected')),
  upload_state text not null default 'pending' check(upload_state in('pending','uploaded')),
  expires_on date,
  storage_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 180),
  content_type text not null check(content_type in('application/pdf','image/jpeg','image/png')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  review_notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((driver_id is null) <> (vehicle_id is null)),
  check(status<>'approved' or upload_state='uploaded')
);
create index admin_document_driver on krow_admin.documents(driver_id,kind,created_at desc) where driver_id is not null;
create index admin_document_vehicle on krow_admin.documents(vehicle_id,kind,created_at desc) where vehicle_id is not null;
create index admin_document_expiry on krow_admin.documents(expires_on) where upload_state='uploaded';
create table krow_admin.audit_log(
  audit_id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null check(entity_type in('driver','vehicle','document')),
  entity_id uuid not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_order on krow_admin.audit_log(created_at desc,audit_id desc);
create index admin_audit_entity on krow_admin.audit_log(entity_type,entity_id,created_at desc);
alter table krow_admin.documents enable row level security;
alter table krow_admin.audit_log enable row level security;
revoke all on all tables in schema krow_admin from public,anon,authenticated;
grant select,insert,update on krow_admin.documents to krow_pilot_service;
grant select,insert on krow_admin.audit_log to krow_pilot_service;
create policy admin_document_read on krow_admin.documents for select to krow_pilot_service using((select private.is_admin_actor()));
create policy admin_document_insert on krow_admin.documents for insert to krow_pilot_service with check((select private.is_admin_actor()) and created_by=auth.uid());
create policy admin_document_update on krow_admin.documents for update to krow_pilot_service using((select private.is_admin_actor())) with check((select private.is_admin_actor()));
create policy admin_audit_read on krow_admin.audit_log for select to krow_pilot_service using((select private.is_admin_actor()));
create policy admin_audit_insert on krow_admin.audit_log for insert to krow_pilot_service with check((select private.is_admin_actor()) and actor_id=auth.uid());
grant insert(user_id,license_number,license_expiry,status,admin_status),update(license_number,license_expiry,status,admin_status) on public.driver_profiles to krow_pilot_service;
create policy admin_driver_insert on public.driver_profiles for insert to krow_pilot_service with check((select private.is_admin_actor()));
grant insert(driver_id,license_plate,brand,model,car_year,car_color,capacity,is_active,admin_status),update(license_plate,brand,model,car_year,car_color,capacity,is_active,admin_status) on public.vehicles to krow_pilot_service;
create policy admin_vehicle_insert on public.vehicles for insert to krow_pilot_service with check((select private.is_admin_actor()));
create policy admin_vehicle_update on public.vehicles for update to krow_pilot_service using((select private.is_admin_actor())) with check((select private.is_admin_actor()));
grant select on public.ride_status_history to krow_pilot_service;
create policy admin_history_read on public.ride_status_history for select to krow_pilot_service using((select private.is_admin_actor()));

-- Sensitive documents are never public. The browser uses its existing user JWT;
-- no service-role key is configured in the frontend or needed by these endpoints.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('krow-admin-documents','krow-admin-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);
create policy krow_admin_document_storage_read on storage.objects for select to authenticated
using(bucket_id='krow-admin-documents' and (select private.is_admin_actor()));
create policy krow_admin_document_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='krow-admin-documents' and (select private.is_admin_actor()) and name ~ '^documents/[0-9a-f-]{36}\.(pdf|jpg|png)$');
-- Immutable file paths: new uploads get a new UUID. No UPDATE/DELETE storage
-- privileges or audit mutation grants are introduced.
commit;
