create table krow_pilot.operational_routes(
  ride_id uuid primary key references public.rides(ride_id) on delete cascade,
  route_id uuid not null default gen_random_uuid(),ride_version integer not null,
  polyline text not null,duration_seconds integer not null check(duration_seconds>=0),
  calculated_at timestamptz not null default now()
);
create table krow_pilot.incidents(
  incident_id uuid primary key default gen_random_uuid(),client_id uuid not null,
  ride_id uuid not null references public.rides(ride_id),actor_id uuid not null references auth.users(id),
  kind text not null check(kind in('safety','vehicle','conduct','other')),details text not null check(length(details) between 1 and 2000),
  status text not null default 'open' check(status in('open','acknowledged','resolved')),
  resolution text,handled_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(actor_id,client_id)
);
create index pilot_incidents_queue on krow_pilot.incidents(status,created_at desc);
create index pilot_incidents_ride on krow_pilot.incidents(ride_id);
alter table krow_pilot.operational_routes enable row level security;
alter table krow_pilot.incidents enable row level security;
revoke all on krow_pilot.operational_routes,krow_pilot.incidents from public,anon,authenticated;
grant select,insert,update,delete on krow_pilot.operational_routes to krow_pilot_service;
grant select,insert,update on krow_pilot.incidents to krow_pilot_service;
create policy pilot_service_routes on krow_pilot.operational_routes to krow_pilot_service using(true) with check(true);
create policy pilot_service_incidents on krow_pilot.incidents to krow_pilot_service using(true) with check(true);

-- Recheck at publication and start, preserving cancellation/completion of an active trip.
create or replace function private.validate_launch_driver()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_today date := (now() at time zone 'America/Monterrey')::date;
begin
  if new.status not in ('scheduled','full','in_progress') then return new; end if;
  -- Seat changes can move full -> scheduled while a passenger cancels.
  -- Eligibility must not prevent that cancellation or interrupt an ongoing trip.
  if tg_op='UPDATE' and (new.status<>'in_progress' or old.status='in_progress') then return new; end if;
  if not exists(select 1 from public.driver_profiles d join public.users u on u.uuid=d.user_id
    where d.driver_id=new.driver_id and d.status='approved' and d.license_expiry>=v_today
      and u.is_active is distinct from false and u.deleted_at is null) then
    raise exception 'El conductor debe estar aprobado y tener licencia vigente';
  end if;
  if current_setting('krow.require_documents',true)='true' then
    if not exists(select 1 from krow_admin.documents where driver_id=new.driver_id and kind='license' and status='approved' and upload_state='uploaded' and expires_on>=v_today)
      or exists(select 1 from (values('insurance'),('registration')) required(kind) where not exists(
        select 1 from krow_admin.documents doc where doc.vehicle_id=new.vehicle_id and doc.kind=required.kind and doc.status='approved' and doc.upload_state='uploaded' and doc.expires_on>=v_today)) then
      raise exception 'La licencia, el seguro y la tarjeta de circulación deben estar aprobados y vigentes';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_launch_driver() from public,anon,authenticated;
create trigger rides_launch_eligibility before insert or update of status,driver_id,vehicle_id on public.rides for each row execute function private.validate_launch_driver();
