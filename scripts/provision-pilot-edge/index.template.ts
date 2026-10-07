import { Client } from '@db/postgres';
import { timingSafeEqual } from 'node:crypto';
import { ROLE_QUERY, MEMBERSHIP_QUERY, DEPENDENCY_QUERY, PRIVILEGE_QUERY,
  validateRoleMetadata, MetadataFault, type Role, type Membership, type Dependency } from './metadata.ts';

// prepare.mjs replaces only this marker with public CA, digests and expiry.
// The deployed source never contains a bearer, password, URL credential or verifier.
type BootstrapConfig = { bearerSha256: string; verifierSha256: string;
  expiresAt: number; ca: string; caSha256: string };
const CONFIG: BootstrapConfig | null = /*__PUBLIC_BOOTSTRAP_CONFIG__*/null;
const PROJECT_REF = 'yyjbqzsokxpzhevpanyq';
const HOST = 'aws-1-us-east-1.pooler.supabase.com';
const ROLE = 'krow_pilot_runtime';
const GROUP = 'krow_pilot_service';
const CA_SHA256 = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';
const VERIFIER_PATTERN = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
const BODY_LIMIT = 512;

class BootstrapFault extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}
function fail(reason: string): never { throw new BootstrapFault(reason); }
const response = (code: string, status: number) => Response.json({
  ok: status === 200, code,
}, { status, headers: { 'Cache-Control': 'no-store' } });
const expired = (): boolean => !CONFIG || !Number.isSafeInteger(CONFIG.expiresAt) || Date.now() >= CONFIG.expiresAt;
const assertFresh = (): void => { if (expired()) fail('EXPIRED'); };

function equalDigest(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const left = new Uint8Array(32);
  const right = new Uint8Array(32);
  for (let index = 0; index < 32; index++) {
    left[index] = Number.parseInt(actual.slice(index * 2, index * 2 + 2), 16);
    right[index] = Number.parseInt(expected.slice(index * 2, index * 2 + 2), 16);
  }
  return timingSafeEqual(left, right);
}
async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, '0')).join('');
}
const textDigest = (value: string): Promise<string> => digest(new TextEncoder().encode(value));

async function body(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST');
  const length = req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) fail('INVALID_REQUEST');
  if (!req.body) fail('INVALID_REQUEST');
  const reader = req.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) fail('INVALID_REQUEST');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)); }
  catch { fail('INVALID_REQUEST'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('INVALID_REQUEST');
  return parsed;
}

async function connect(): Promise<Client> {
  if (!CONFIG || Deno.env.get('SUPABASE_URL') !== `https://${PROJECT_REF}.supabase.co` ||
      CONFIG.caSha256 !== CA_SHA256) fail('CONFIGURATION_REQUIRED');
  const encoded = CONFIG.ca.replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(encoded), (part) => part.charCodeAt(0));
  if ((await digest(der)).toUpperCase() !== CA_SHA256) fail('CONFIGURATION_REQUIRED');
  let url: URL;
  try { url = new URL(Deno.env.get('SUPABASE_DB_URL') ?? ''); }
  catch { fail('CONFIGURATION_REQUIRED'); }
  // The documented secret's hosted username is not guaranteed. Fail closed
  // unless it is postgres; never transmit its URL, or select another identity.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['postgres', `postgres.${PROJECT_REF}`].includes(decodeURIComponent(url.username)) ||
      decodeURIComponent(url.pathname) !== '/postgres' || !url.password) fail('CONFIGURATION_REQUIRED');
  const client = new Client({
    hostname: HOST, port: 5432, database: 'postgres', user: `postgres.${PROJECT_REF}`,
    password: decodeURIComponent(url.password),
    tls: { enabled: true, enforce: true, caCertificates: [CONFIG.ca] },
    connection: { attempts: 1 }, controls: { debug: false },
    applicationName: 'krow-private-runtime-bootstrap',
  });
  assertFresh(); // immediately before opening any privileged SQL connection
  try { await client.connect(); }
  catch { await client.end().catch(() => {}); fail('OPERATION_FAILED'); }
  if (client.session.tls !== true || client.session.transport !== 'tcp') {
    await client.end().catch(() => {});
    fail('ADMIN_TLS_REQUIRED');
  }
  return client;
}

async function validate(client: Client): Promise<void> {
  const identity = (await client.queryObject<{ role: string; database: string;
    creator: boolean; administrator: boolean }>({ text: `
    select current_user as role, current_database() as database,
      coalesce((select rolcreaterole from pg_roles where rolname = current_user), false) as creator,
      exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
        join pg_roles member on member.oid = m.member
        where r.rolname = $1 and member.rolname = current_user and m.admin_option) as administrator`, args: [ROLE] })).rows[0];
  if (identity?.role !== 'postgres') fail('UNEXPECTED_ADMIN_IDENTITY');
  if (identity?.database !== 'postgres') fail('UNEXPECTED_ADMIN_DATABASE');
  if (identity.creator !== true || identity.administrator !== true) fail('ADMIN_PERMISSION_REQUIRED');
  const args = [ROLE, GROUP];
  const roles = (await client.queryObject<Role>({ text: ROLE_QUERY, args })).rows;
  const memberships = (await client.queryObject<Membership>({ text: MEMBERSHIP_QUERY, args })).rows;
  const dependencies = (await client.queryObject<Dependency>({ text: DEPENDENCY_QUERY, args })).rows;
  validateRoleMetadata(roles, memberships, dependencies, false);
  for (const role of [ROLE, GROUP]) {
    if ((await client.queryObject<{ ready: boolean }>({ text: PRIVILEGE_QUERY, args: [role] })).rows[0]?.ready !== true) {
      fail('PILOT_PRIVILEGES_REQUIRED');
    }
  }
}

export async function handler(req: Request): Promise<Response> {
  let client: Client | undefined;
  let transaction = false;
  try {
    if (expired()) return response('EXPIRED', 410);
    if (req.method !== 'POST') return response('INVALID_REQUEST', 405);
    const authorization = req.headers.get('authorization');
    // Authentication happens before reading a request body or connecting SQL.
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) ||
        !CONFIG || !equalDigest(await textDigest(authorization.slice(7)), CONFIG.bearerSha256)) {
      return response('UNAUTHORIZED', 401);
    }
    const input = await body(req);
    if (input.op === 'preflight') {
      if (Object.keys(input).join(',') !== 'op') fail('INVALID_REQUEST');
    } else if (input.op === 'provision') {
      if (Object.keys(input).sort().join(',') !== 'op,verifier' ||
          typeof input.verifier !== 'string' || !VERIFIER_PATTERN.test(input.verifier) ||
          !equalDigest(await textDigest(input.verifier), CONFIG.verifierSha256)) fail('INVALID_VERIFIER');
    } else fail('INVALID_REQUEST');
    assertFresh();
    client = await connect();
    await client.queryArray(input.op === 'preflight' ? 'begin read only' : 'begin');
    transaction = true;
    await client.queryArray("set local statement_timeout = '8s'");
    await client.queryArray("set local lock_timeout = '3s'");
    if (input.op === 'provision') {
      await client.queryArray("select pg_advisory_xact_lock(hashtextextended('krow-pilot-runtime-provision', 0))");
      assertFresh(); // queued or concurrent invocations must not outlive expiry
    }
    await validate(client);
    if (input.op === 'provision') {
      assertFresh();
      // Only the exact verifier bound to the source is accepted. Its fixed
      // alphabet excludes SQL quotes. No caller-controlled SQL or role names.
      await client.queryArray(`alter role ${ROLE} password '${input.verifier}'`);
      assertFresh();
      await client.queryArray(`alter role ${ROLE} login`);
    }
    assertFresh();
    await client.queryArray('commit');
    transaction = false;
    return response(input.op === 'preflight' ? 'READY' : 'PROVISIONED', 200);
  } catch (error) {
    // Never print exceptions, notices, request headers/bodies, SQL or secrets.
    const code = error instanceof BootstrapFault || error instanceof MetadataFault
      ? error.reason : 'OPERATION_FAILED';
    return response(code, code === 'EXPIRED' ? 410 : 400);
  } finally {
    if (transaction && client) await client.queryArray('rollback').catch(() => {});
    if (client) await client.end().catch(() => {});
  }
}

Deno.serve(handler);
