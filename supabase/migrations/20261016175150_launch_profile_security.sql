-- Signup metadata contains presentation data only, never authorization.
grant insert(profile_photo),update(profile_photo) on public.users to krow_pilot_service;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id text := nullif(left(btrim(new.raw_user_meta_data->>'institutional_id'),50),'');
  v_period text := new.raw_user_meta_data->>'academic_period';
begin
  if exists(select 1 from public.users where institutional_id=v_id) then v_id:=null; end if;
  insert into public.users(uuid,full_name,email_address,profile_photo,institutional_id,academic_program,academic_period)
  values(new.id,left(btrim(new.raw_user_meta_data->>'full_name'),150),new.email,
    case when new.raw_user_meta_data->>'avatar_url' ~ '^https://[^[:space:]]+$' then left(new.raw_user_meta_data->>'avatar_url',500) end,
    v_id,nullif(left(btrim(new.raw_user_meta_data->>'academic_program'),150),''),
    case when v_period ~ '^([1-9]|1[0-9]|20)$' then v_period::integer end);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

-- Repair only absent fields. Conflicting IDs remain unset for explicit correction.
with metadata as (
  select a.id,nullif(left(btrim(a.raw_user_meta_data->>'institutional_id'),50),'') institutional_id,
    nullif(left(btrim(a.raw_user_meta_data->>'academic_program'),150),'') program,
    case when a.raw_user_meta_data->>'academic_period' ~ '^([1-9]|1[0-9]|20)$'
      then (a.raw_user_meta_data->>'academic_period')::integer end period
  from auth.users a
), candidates as (
  select *,count(*) over(partition by institutional_id) duplicates from metadata
)
update public.users u set
  institutional_id=coalesce(u.institutional_id,case when c.duplicates=1 and not exists(
    select 1 from public.users other where other.institutional_id=c.institutional_id and other.uuid<>u.uuid
  ) then c.institutional_id end),
  academic_program=coalesce(u.academic_program,c.program),academic_period=coalesce(u.academic_period,c.period)
from candidates c where c.id=u.uuid and u.is_active is distinct from false and u.deleted_at is null
  and (u.institutional_id is null or u.academic_program is null or u.academic_period is null);

-- Legacy payment records must never become client-certified receipts.
revoke insert,update,delete on public.payments from anon,authenticated;
drop policy if exists payments_insert_booker on public.payments;

-- Expiry is housekeeping even when delivery is intentionally disabled.
update krow_pilot.outbox set status='expired',lease_until=null where status='pending' and expires_at<=now();
