-- Credential-free preparation for the API's dedicated login.
-- Password provisioning happens only through a private local TLS connection.
do $$
begin
  if not exists(select 1 from pg_roles where rolname='krow_pilot_service') then
    raise exception 'Apply the audited pilot permission group first';
  end if;
  if exists(select 1 from pg_roles where rolname='krow_pilot_runtime') then
    raise exception 'Runtime role already exists; review before altering it';
  end if;
end;
$$;

create role krow_pilot_runtime nologin inherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls connection limit 12;
grant krow_pilot_service to krow_pilot_runtime with inherit true;
grant krow_pilot_service to krow_pilot_runtime with admin false;
grant krow_pilot_service to krow_pilot_runtime with set false;
