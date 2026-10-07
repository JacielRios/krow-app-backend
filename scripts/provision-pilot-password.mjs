import * as fileSystem from 'node:fs/promises';
import { createHash, createHmac, pbkdf2Sync, randomBytes, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Credential provisioning is deliberately separate from MCP and migrations.
// The only administrative credential input is the dedicated, ignored file.
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const PROJECT_REF = 'yyjbqzsokxpzhevpanyq';
const HOST = 'aws-1-us-east-1.pooler.supabase.com';
const GROUP = 'krow_pilot_service';
const RUNTIME_ROLE = 'krow_pilot_runtime';
const CA_SHA256 = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';
const ITERATIONS = 4096;

class ProvisioningFault extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const fail = (reason) => { throw new ProvisioningFault(reason); };

// ASCII passwords generated below need no SASLprep transformation. PostgreSQL
// REL_17_STABLE/src/common/scram-common.c defines this stored verifier format.
export function buildScramVerifier(password, salt, iterations = ITERATIONS) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(password) || salt.length !== 16 ||
      !Number.isSafeInteger(iterations) || iterations < 4096 || iterations > 1000000) {
    fail('INVALID_GENERATED_CREDENTIAL');
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  salted.fill(0);
  clientKey.fill(0);
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

const ROLE_QUERY = `
  select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
    rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil is null as no_expiry
  from pg_roles where rolname in ($1, $2)`;

const MEMBERSHIP_QUERY = `
  select parent.rolname as parent, member.rolname as member,
    m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m
  join pg_roles parent on parent.oid = m.roleid
  join pg_roles member on member.oid = m.member
  -- Incoming creator-admin grants do not grant powers to the runtime role.
  -- PostgreSQL 17 automatically gives its CREATEROLE creator such a grant.
  where member.rolname in ($1, $2)`;

const DEPENDENCY_QUERY = `
  select r.rolname,
    count(*) filter (where d.deptype = 'o')::integer as owned_objects,
    count(*) filter (where d.deptype = 'a')::integer as direct_grants
  from pg_roles r
  left join pg_shdepend d on d.refclassid = 'pg_authid'::regclass
    and d.refobjid = r.oid
  where r.rolname in ($1, $2) group by r.rolname`;

// Checks grants and schema metadata only; never reads application records.
const PRIVILEGE_QUERY = `
  select
    to_regclass('krow_pilot.tracking_sessions') is not null
    and to_regclass('krow_pilot.outbox') is not null
    and to_regclass('krow_pilot.account_closure_requests') is not null
    and has_schema_privilege($1::name, 'public', 'USAGE')
    and has_schema_privilege($1::name, 'krow_pilot', 'USAGE')
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

export function validateRoleMetadata(roles, memberships, dependencies, expectedLogin) {
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

export function validateRecoveryUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_RECOVERY_FILE'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== HOST || url.port !== '5432' ||
      url.pathname !== '/postgres' || url.username !== `${RUNTIME_ROLE}.${PROJECT_REF}` ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.password) || url.search || url.hash) {
    fail('INVALID_RECOVERY_FILE');
  }
  return url.password;
}

export function configureRuntimeUrl(envText, runtimeUrl, parse) {
  validateRecoveryUrl(runtimeUrl);
  const configured = parse(envText).PILOT_DATABASE_URL;
  if (configured !== undefined && configured.trim() !== '') fail('RUNTIME_URL_ALREADY_CONFIGURED');
  const newline = envText.includes('\r\n') ? '\r\n' : '\n';
  const definition = /^\s*(?:export\s+)?PILOT_DATABASE_URL\s*=/;
  const emptyDefinition = /^\s*(?:export\s+)?PILOT_DATABASE_URL\s*=\s*(?:""|'')?\s*(?:#.*)?$/;
  let inserted = false;
  const result = envText.split(/\r?\n/).flatMap((line) => {
    if (!definition.test(line)) return [line];
    if (!emptyDefinition.test(line)) fail('INVALID_RUNTIME_URL_PLACEHOLDER');
    if (inserted) return [];
    inserted = true;
    return [`PILOT_DATABASE_URL=${runtimeUrl}`];
  });
  let text = result.join(newline);
  if (!inserted) text += `${text.endsWith(newline) || !text ? '' : newline}PILOT_DATABASE_URL=${runtimeUrl}${newline}`;
  return text;
}

async function regularText(fs, path, reason) {
  let stat;
  try { stat = await fs.lstat(path); } catch { fail(reason); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_FILE_PATH');
  return fs.readFile(path, 'utf8');
}

async function exists(fs, path) {
  try { await fs.lstat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeExclusive(fs, path, text) {
  const file = await fs.open(path, 'wx', 0o600);
  try {
    await file.writeFile(text, 'utf8');
    await file.sync();
  } finally { await file.close(); }
}

async function verifyMetadata(client, expectedLogin) {
  const args = [RUNTIME_ROLE, GROUP];
  const roles = (await client.query(ROLE_QUERY, args)).rows;
  const memberships = (await client.query(MEMBERSHIP_QUERY, args)).rows;
  const dependencies = (await client.query(DEPENDENCY_QUERY, args)).rows;
  validateRoleMetadata(roles, memberships, dependencies, expectedLogin);
  for (const role of [GROUP, RUNTIME_ROLE]) {
    if ((await client.query(PRIVILEGE_QUERY, [role])).rows[0]?.ready !== true) {
      fail('PILOT_PRIVILEGES_REQUIRED');
    }
  }
}

// Dependency injection allows synthetic verification without reading real env
// files or opening any network connection. CLI paths and project are fixed.
export async function provisionPilotPassword({
  recover = false, fs = fileSystem, Client, parse, root = workspaceRoot, onStage = () => {},
} = {}) {
  Client ??= requireFromApi('pg').Client;
  parse ??= requireFromApi('dotenv').parse;
  const privateDirectory = resolve(root, '.temp/pilot-provision');
  const inputPath = resolve(privateDirectory, '.env');
  const recoveryPath = resolve(privateDirectory, 'runtime.env');
  const lockPath = resolve(privateDirectory, 'provision.lock');
  const apiEnvPath = resolve(root, 'apps/api/.env');
  let admin;
  let runtime;
  let locked = false;
  let transactionOpen = false;
  const stage = (name) => onStage(name);

  const connect = async (user, password, ca) => {
    const client = new Client({
      host: HOST, port: 5432, database: 'postgres', user, password,
      ssl: { ca, rejectUnauthorized: true, servername: HOST },
      connectionTimeoutMillis: 10000, query_timeout: 15000, statement_timeout: 12000,
      application_name: 'krow-private-credential-provision',
    });
    // Never print driver error/notice objects: they may include SQL or secrets.
    client.on('error', () => {});
    try { await client.connect(); } catch (error) {
      await client.end().catch(() => {});
      throw error;
    }
    return client;
  };

  try {
    stage('input');
    for (const directory of [root, resolve(root, '.temp'), privateDirectory, dirname(apiEnvPath)]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_FILE_PATH');
      const resolved = await fs.realpath(directory);
      const inside = relative(await fs.realpath(root), resolved);
      if (inside.startsWith('..') || isAbsolute(inside)) fail('UNSAFE_FILE_PATH');
    }
    if (await exists(fs, lockPath)) fail('PROVISION_LOCK_PRESENT');
    await writeExclusive(fs, lockPath, 'KROW private credential provisioning in progress.\n');
    locked = true;
    const initialEnv = await regularText(fs, apiEnvPath, 'API_ENV_REQUIRED');
    const apiValues = parse(initialEnv);
    if (apiValues.PILOT_DATABASE_URL?.trim()) fail('RUNTIME_URL_ALREADY_CONFIGURED');
    const ca = apiValues.PILOT_DATABASE_CA?.replace(/\\n/g, '\n').trim();
    const certificates = ca?.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!ca || certificates?.length !== 1 || ca.replace(certificates[0], '').trim()) fail('VERIFIED_CA_REQUIRED');
    let certificate;
    try { certificate = new X509Certificate(ca); } catch { fail('VERIFIED_CA_REQUIRED'); }
    if (certificate.fingerprint256.replaceAll(':', '') !== CA_SHA256 || !certificate.ca ||
        Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
      fail('VERIFIED_CA_REQUIRED');
    }

    let runtimePassword;
    let runtimeUrl;
    if (recover) {
      stage('recovery');
      const values = parse(await regularText(fs, recoveryPath, 'RECOVERY_FILE_REQUIRED'));
      if (Object.keys(values).length !== 1 || !values.PILOT_DATABASE_URL) fail('INVALID_RECOVERY_FILE');
      runtimeUrl = values.PILOT_DATABASE_URL;
      runtimePassword = validateRecoveryUrl(runtimeUrl);
    } else {
      if (await exists(fs, recoveryPath)) fail('RECOVERY_REQUIRED');
      const input = parse(await regularText(fs, inputPath, 'ADMIN_INPUT_REQUIRED'));
      if (Object.keys(input).length !== 1 || typeof input.PILOT_ADMIN_PASSWORD !== 'string' ||
          !input.PILOT_ADMIN_PASSWORD) fail('ADMIN_INPUT_REQUIRED');
      stage('admin_authentication');
      admin = await connect(`postgres.${PROJECT_REF}`, input.PILOT_ADMIN_PASSWORD, ca);
      const identity = (await admin.query('select current_user as role, current_database() as database')).rows[0];
      if (identity?.role !== 'postgres' || identity?.database !== 'postgres') fail('UNEXPECTED_ADMIN_IDENTITY');
      stage('role_validation');
      await admin.query('begin');
      transactionOpen = true;
      // Serialize cooperating provisioning sessions without changing any schema.
      await admin.query("select pg_advisory_xact_lock(hashtextextended('krow-pilot-runtime-provision', 0))");
      await verifyMetadata(admin, false);
      runtimePassword = randomBytes(32).toString('base64url');
      runtimeUrl = `postgresql://${RUNTIME_ROLE}.${PROJECT_REF}:${runtimePassword}@${HOST}:5432/postgres`;
      configureRuntimeUrl(initialEnv, runtimeUrl, parse);
      const verifier = buildScramVerifier(runtimePassword, randomBytes(16));
      if (!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(verifier)) {
        fail('INVALID_GENERATED_CREDENTIAL');
      }
      stage('credential_provisioning');
      // The verifier is generated locally, contains no SQL quote characters,
      // is sent only to this private pg connection, and is never persisted.
      await admin.query(`alter role ${RUNTIME_ROLE} password '${verifier}'`);
      await admin.query(`alter role ${RUNTIME_ROLE} login`);
      stage('recovery_saved');
      await writeExclusive(fs, recoveryPath, `# Private recovery credential; never upload or print.\nPILOT_DATABASE_URL=${runtimeUrl}\n`);
      stage('commit');
      await admin.query('commit');
      transactionOpen = false;
      await admin.end();
      admin = undefined;
    }

    stage('runtime_verification');
    runtime = await connect(`${RUNTIME_ROLE}.${PROJECT_REF}`, runtimePassword, ca);
    const identity = (await runtime.query('select current_user as role, current_database() as database')).rows[0];
    if (identity?.role !== RUNTIME_ROLE || identity?.database !== 'postgres') fail('UNEXPECTED_RUNTIME_IDENTITY');
    await verifyMetadata(runtime, true);
    await runtime.end();
    runtime = undefined;

    stage('local_configuration');
    const currentEnv = await regularText(fs, apiEnvPath, 'API_ENV_REQUIRED');
    // Preserve all other values and refuse a concurrent runtime configuration.
    const updatedEnv = configureRuntimeUrl(currentEnv, runtimeUrl, parse);
    if (parse(currentEnv).PILOT_DATABASE_CA !== apiValues.PILOT_DATABASE_CA) fail('API_ENV_CHANGED');
    // Keep the complete temporary env inside .temp, which existing Git,
    // Docker and Railway exclusions cover even if rename is interrupted.
    const pendingPath = resolve(privateDirectory, 'api.env.pending');
    if (await exists(fs, pendingPath)) fail('API_ENV_PENDING_PRESENT');
    await writeExclusive(fs, pendingPath, updatedEnv);
    const beforeRename = await regularText(fs, apiEnvPath, 'API_ENV_REQUIRED');
    if (beforeRename !== currentEnv) {
      await fs.unlink(pendingPath);
      fail('API_ENV_CHANGED');
    }
    await fs.rename(pendingPath, apiEnvPath);
    stage('complete');
    return { ok: true, runtimeAuthenticated: true, permissionsReady: true, localEnvironmentConfigured: true };
  } finally {
    if (transactionOpen && admin) await admin.query('rollback').catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (runtime) await runtime.end().catch(() => {});
    if (locked) await fs.unlink(lockPath).catch(() => {});
  }
}

async function main() {
  let stage = 'input';
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--recover')) fail('INVALID_ARGUMENTS');
    const result = await provisionPilotPassword({ recover: args[0] === '--recover', onStage: (value) => { stage = value; } });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    // Do not print exception strings, SQL, connection URLs, or driver fields.
    const reason = error instanceof ProvisioningFault ? error.reason : 'OPERATION_FAILED';
    process.stdout.write(`${JSON.stringify({ ok: false, stage, reason })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
