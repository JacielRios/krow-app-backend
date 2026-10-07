// Credential-free metadata checks shared by the generated Edge Function.
const RUNTIME_ROLE = 'krow_pilot_runtime';
const GROUP = 'krow_pilot_service';
export class MetadataFault extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}
function fail(reason: string): never { throw new MetadataFault(reason); }
export type Role = { rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolreplication: boolean; rolbypassrls: boolean; rolconnlimit: number; no_expiry: boolean };
export type Membership = { parent: string; member: string; admin_option: boolean; inherit_option: boolean; set_option: boolean };
export type Dependency = { rolname: string; owned_objects: number; direct_grants: number };

export const ROLE_QUERY = `
  select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
    rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil is null as no_expiry
  from pg_roles where rolname in ($1, $2)`;

export const MEMBERSHIP_QUERY = `
  select parent.rolname as parent, member.rolname as member,
    m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m
  join pg_roles parent on parent.oid = m.roleid
  join pg_roles member on member.oid = m.member
  -- Incoming creator-admin grants do not grant powers to the runtime role.
  -- PostgreSQL 17 automatically gives its CREATEROLE creator such a grant.
  where member.rolname in ($1, $2)`;

export const DEPENDENCY_QUERY = `
  select r.rolname,
    count(*) filter (where d.deptype = 'o')::integer as owned_objects,
    count(*) filter (where d.deptype = 'a')::integer as direct_grants
  from pg_roles r
  left join pg_shdepend d on d.refclassid = 'pg_authid'::regclass
    and d.refobjid = r.oid
  where r.rolname in ($1, $2) group by r.rolname`;

// Checks grants and schema metadata only; never reads application records.
export const PRIVILEGE_QUERY = `
  select
    to_regclass('krow_pilot.tracking_sessions') is not null
    and to_regclass('krow_pilot.outbox') is not null
    and to_regclass('krow_pilot.account_closure_requests') is not null
    and has_schema_privilege($1::name, 'public', 'USAGE')
    and has_schema_privilege($1::name, 'krow_pilot', 'USAGE')
    and not has_database_privilege($1::name, current_database(), 'CREATE')
    and not exists (select 1 from pg_namespace n
      where has_schema_privilege($1::name, n.oid, 'CREATE'))
    and not exists (
      select 1 from (values ('users'), ('driver_profiles'), ('vehicles'),
        ('rides'), ('bookings'), ('ride_stops')) t(name)
      where not has_table_privilege($1::name, 'public.' || t.name, 'SELECT'))
    and not exists (
      select 1 from (values ('status'), ('version'), ('updated_at'),
        ('available_seats')) c(name)
      where not has_column_privilege($1::name, 'public.rides', c.name, 'UPDATE'))
    and has_column_privilege($1::name, 'public.bookings', 'status', 'UPDATE')
    and has_column_privilege($1::name, 'public.users', 'rating', 'UPDATE')
    and has_column_privilege($1::name, 'public.users', 'is_active', 'UPDATE')
    and has_column_privilege($1::name, 'public.driver_profiles', 'rating', 'UPDATE')
    and not exists (
      select 1 from (values ('uuid'), ('email_address'), ('full_name'),
        ('institutional_id'), ('academic_program'), ('academic_period')) c(name)
      where not has_column_privilege($1::name, 'public.users', c.name, 'INSERT'))
    and not exists (
      select 1 from (values ('email_address'), ('full_name'), ('institutional_id'),
        ('academic_program'), ('academic_period')) c(name)
      where not has_column_privilege($1::name, 'public.users', c.name, 'UPDATE'))
    and has_table_privilege($1::name, 'public.ride_reviews', 'SELECT')
    and has_table_privilege($1::name, 'public.ride_reviews', 'INSERT')
    and has_table_privilege($1::name, 'public.ride_status_history', 'INSERT')
    and not exists (
      select 1 from (values ('public.create_ride_v2(jsonb)'),
        ('public.update_ride_v2(uuid,integer,jsonb)'),
        ('public.upsert_favorite_route(jsonb)'),
        ('public.request_booking_v2(jsonb)'),
        ('public.delete_favorite_route(uuid)')) f(signature)
      where not has_function_privilege($1::name, f.signature, 'EXECUTE'))
    and not exists (
      select 1 from (values ('public.users'), ('public.ride_status_history')) t(name)
      where pg_get_serial_sequence(t.name, 'id') is not null
        and not has_sequence_privilege($1::name, pg_get_serial_sequence(t.name, 'id'), 'USAGE'))
    and not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'krow_pilot' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (not has_table_privilege($1::name, c.oid, 'SELECT')
          or not has_table_privilege($1::name, c.oid, 'INSERT')
          or not has_table_privilege($1::name, c.oid, 'UPDATE')
          or not has_table_privilege($1::name, c.oid, 'DELETE')))
    as ready`;

export function validateRoleMetadata(roles: Role[], memberships: Membership[], dependencies: Dependency[], expectedLogin: boolean) {
  const runtime = roles.find((role) => role.rolname === RUNTIME_ROLE);
  const group = roles.find((role) => role.rolname === GROUP);
  if (!runtime || !group) fail('PREPARED_ROLES_REQUIRED');
  for (const role of [runtime, group]) {
    if (role.rolsuper !== false || role.rolcreatedb !== false ||
        role.rolcreaterole !== false || role.rolreplication !== false ||
        role.rolbypassrls !== false || role.no_expiry !== true) fail('UNSAFE_ROLE');
  }
  if (runtime.rolcanlogin !== expectedLogin) {
    fail(expectedLogin ? 'RUNTIME_LOGIN_REQUIRED' : 'RUNTIME_ALREADY_LOGIN');
  }
  if (group.rolcanlogin !== false || group.rolinherit !== false ||
      runtime.rolinherit !== true || runtime.rolconnlimit !== 12) fail('UNSAFE_ROLE');
  if (memberships.length !== 1 || memberships[0].parent !== GROUP ||
      memberships[0].member !== RUNTIME_ROLE ||
      memberships[0].admin_option !== false || memberships[0].set_option !== false ||
      memberships[0].inherit_option !== true) fail('UNSAFE_MEMBERSHIP');
  for (const name of [RUNTIME_ROLE, GROUP]) {
    const dependency = dependencies.find((entry) => entry.rolname === name);
    if (!dependency || dependency.owned_objects !== 0 ||
        (name === RUNTIME_ROLE && dependency.direct_grants !== 0)) {
      fail('UNEXPECTED_ROLE_PRIVILEGES');
    }
  }
}
