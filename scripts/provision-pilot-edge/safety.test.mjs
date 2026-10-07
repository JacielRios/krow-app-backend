import assert from 'node:assert/strict';
import * as realFs from 'node:fs/promises';
import vm from 'node:vm';
import { randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { prepare } from './prepare.mjs';
import { invoke } from './invoke.mjs';
import { CA_SHA256, FUNCTION_URL, PROJECT_REF, ROLE, GROUP, HOST, requireFromApi } from './common.mjs';

// All credentials, filesystem mutations, requests and SQL connections below
// are synthetic. Only credential-free source and the public CA fixture are read.
const ts = requireFromApi('typescript');
const parse = requireFromApi('dotenv').parse;
const ca = await realFs.readFile(new URL('./public-ca.fixture.crt', import.meta.url), 'utf8');
const template = await realFs.readFile(new URL('./index.template.ts', import.meta.url), 'utf8');
const metadata = await realFs.readFile(new URL('./metadata.ts', import.meta.url), 'utf8');
const retired = await realFs.readFile(new URL('./retired.ts', import.meta.url), 'utf8');
const root = resolve('C:/synthetic-edge-bootstrap');
const privateDirectory = resolve(root, '.temp/pilot-provision');
const bundlePath = resolve(privateDirectory, 'edge-request.json');
const recoveryPath = resolve(privateDirectory, 'runtime.env');
const sourcePath = resolve(privateDirectory, 'edge-source/index.ts');
const apiPath = resolve(root, 'apps/api/.env');
let checks = 0;

function memoryFs() {
  const files = new Map([[apiPath, `SUPABASE_URL=https://${PROJECT_REF}.supabase.co\nPILOT_DATABASE_URL=\nPILOT_DATABASE_CA="${ca.replaceAll('\n', '\\n')}"\nOTHER=synthetic\n`]]);
  const directories = new Set([root, resolve(root, '.temp'), privateDirectory, resolve(root, 'apps/api')]);
  const writes = [];
  const missing = () => Object.assign(new Error('synthetic'), { code: 'ENOENT' });
  return { files, directories, writes,
    async lstat(path) {
      if (!files.has(path) && !directories.has(path)) throw missing();
      return { isFile: () => files.has(path), isDirectory: () => directories.has(path), isSymbolicLink: () => false };
    },
    async realpath(path) { return path; },
    async readFile(path) { if (!files.has(path)) throw missing(); return files.get(path); },
    async open(path, mode, permissions) {
      assert.equal(mode, 'wx'); assert.equal(permissions, 0o600);
      if (files.has(path)) throw Object.assign(new Error('synthetic'), { code: 'EEXIST' });
      files.set(path, ''); writes.push(path);
      return { async writeFile(value) { files.set(path, value); }, async sync() {}, async close() {} };
    },
    async unlink(path) { if (!files.delete(path)) throw missing(); },
    async mkdir(path) { if (directories.has(path)) throw new Error('synthetic'); directories.add(path); },
  };
}
async function prepared() {
  const fs = memoryFs();
  const now = 1801782000000;
  const result = await prepare({ fs, root, parse, now: () => now,
    random: randomBytes, templateText: template, metadataText: metadata });
  assert.equal(result.prepared, true);
  const bundle = JSON.parse(fs.files.get(bundlePath));
  return { fs, now, bundle, source: fs.files.get(sourcePath) };
}
function transpile(text) {
  const result = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
  assert.equal(result.diagnostics.length, 0);
  return result.outputText;
}
function semanticCheck(source) {
  const virtualRoot = resolve(root, 'virtual');
  const index = resolve(virtualRoot, 'index.ts');
  const meta = resolve(virtualRoot, 'metadata.ts');
  const declarations = resolve(virtualRoot, 'runtime.d.ts');
  const files = new Map([[index, source], [meta, metadata], [declarations, `
    declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response> | Response): void };
    declare module 'node:crypto' { export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean; }
    declare module '@db/postgres' { export class Client {
      constructor(options: unknown); connect(): Promise<void>; end(): Promise<void>;
      readonly session: { tls: boolean | undefined; transport: 'tcp' | 'socket' | undefined };
      queryObject<T extends Record<string, unknown>>(options: { text: string; args?: unknown[] }): Promise<{ rows: T[] }>;
      queryArray(options: string): Promise<unknown>;
    } }
  `]]);
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true,
    allowImportingTsExtensions: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] };
  const host = ts.createCompilerHost(options);
  const originalGetSource = host.getSourceFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalRead = host.readFile.bind(host);
  host.fileExists = (path) => files.has(resolve(path)) || originalExists(path);
  host.readFile = (path) => files.get(resolve(path)) ?? originalRead(path);
  host.getSourceFile = (path, language, error, fresh) => files.has(resolve(path))
    ? ts.createSourceFile(path, files.get(resolve(path)), language, true) : originalGetSource(path, language, error, fresh);
  host.resolveModuleNames = (names) => names.map((name) => name === './metadata.ts'
    ? { resolvedFileName: meta, extension: ts.Extension.Ts } : undefined);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([index, meta, declarations], options, host));
  assert.equal(diagnostics.length, 0, diagnostics.map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')).join('\n'));
}
function edgeHarness(source, synthetic) {
  const state = { time: synthetic.now + 1, login: false, committed: 0,
    connected: 0, queries: [], config: null, deny: null, expireAtLock: false, expireAtPassword: false };
  let metaExports;
  class Client {
    constructor(config) { state.config = config; }
    get session() { return { tls: state.deny === 'tls' ? false : state.deny === 'missingTls' ? undefined : true,
      transport: state.deny === 'transport' ? 'socket' : 'tcp' }; }
    async connect() { state.connected++; }
    async end() {}
    async queryObject({ text }) {
      state.queries.push(text);
      if (text.includes('current_user as role')) return { rows: [{ role: state.deny === 'identity' ? 'other' : 'postgres',
        database: state.deny === 'database' ? 'other' : 'postgres', creator: state.deny !== 'creator',
        administrator: state.deny !== 'admin', tls: false }] };
      if (text === metaExports.ROLE_QUERY) return { rows: [ROLE, GROUP].map((rolname) => ({ rolname,
        rolcanlogin: rolname === ROLE && state.login, rolsuper: state.deny === 'super', rolcreatedb: false,
        rolcreaterole: false, rolinherit: rolname === ROLE, rolreplication: false, rolbypassrls: false,
        rolconnlimit: rolname === ROLE ? 12 : -1, no_expiry: true })) };
      if (text === metaExports.MEMBERSHIP_QUERY) return { rows: [{ parent: GROUP, member: ROLE,
        admin_option: state.deny === 'membershipAdmin', set_option: state.deny === 'membershipSet', inherit_option: true }] };
      if (text === metaExports.DEPENDENCY_QUERY) return { rows: [ROLE, GROUP].map((rolname) => ({ rolname,
        owned_objects: state.deny === 'owner' ? 1 : 0, direct_grants: rolname === ROLE && state.deny === 'directGrant' ? 1 : 0 })) };
      if (text === metaExports.PRIVILEGE_QUERY) return { rows: [{ ready: state.deny !== 'privilege' }] };
      throw new Error('unexpected_synthetic_query');
    }
    async queryArray(text) {
      state.queries.push(text);
      if (text.startsWith('begin')) this.initialLogin = state.login;
      if (text.includes('pg_advisory_xact_lock') && state.expireAtLock) state.time = synthetic.bundle.expiresAt;
      if (text.startsWith('alter role') && text.includes('password') && state.expireAtPassword) state.time = synthetic.bundle.expiresAt;
      if (text.endsWith(' login')) state.login = true;
      if (text === 'commit') state.committed++;
      if (text === 'rollback') state.login = this.initialLogin;
    }
  }
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports,
    require: (name) => {
      if (name === './metadata.ts') return metaExports;
      if (name === '@db/postgres') return { Client };
      if (name === 'node:crypto') return { timingSafeEqual };
      throw new Error('unexpected_synthetic_import');
    }, Request, Response, URL, Uint8Array, TextEncoder, TextDecoder, atob,
    crypto: webcrypto, Date: class extends Date { static now() { return state.time; } },
    Deno: { env: { get: (name) => name === 'SUPABASE_URL' ? `https://${PROJECT_REF}.supabase.co`
      : name === 'SUPABASE_DB_URL' ? `postgresql://postgres:synthetic_admin@db.${PROJECT_REF}.supabase.co:5432/postgres` : undefined },
      serve: (handler) => { state.handler = handler; } },
    console: { log: () => { throw new Error('logging_forbidden'); }, error: () => { throw new Error('logging_forbidden'); }, warn: () => { throw new Error('logging_forbidden'); } },
  });
  const metaModule = { exports: {} };
  context.module = metaModule; context.exports = metaModule.exports;
  vm.runInContext(`(function(exports,module,require){${transpile(metadata)}\n})(exports,module,require)`, context);
  metaExports = metaModule.exports;
  context.module = module; context.exports = module.exports;
  vm.runInContext(`(function(exports,module,require){${transpile(source)}\n})(exports,module,require)`, context);
  const call = async (input, token = synthetic.bundle.token) => {
    const result = await state.handler(new Request(FUNCTION_URL, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    return { status: result.status, json: await result.json() };
  };
  return { state, call };
}

const preparedState = await prepared();
for (const secret of [preparedState.bundle.token, preparedState.bundle.verifier,
  parse(preparedState.fs.files.get(recoveryPath)).PILOT_DATABASE_URL]) assert.equal(preparedState.source.includes(secret), false);
assert.equal(preparedState.fs.writes.every((path) => path.startsWith(privateDirectory)), true);
assert.equal(preparedState.fs.files.get(apiPath).includes('PILOT_DATABASE_URL=\n'), true);
semanticCheck(preparedState.source); checks++;

for (const scenario of ['existingRecovery', 'configuredUrl', 'wrongProject', 'wrongCa']) {
  const fs = memoryFs();
  if (scenario === 'existingRecovery') fs.files.set(recoveryPath, 'synthetic');
  if (scenario === 'configuredUrl') fs.files.set(apiPath, fs.files.get(apiPath).replace('PILOT_DATABASE_URL=\n', 'PILOT_DATABASE_URL=existing\n'));
  if (scenario === 'wrongProject') fs.files.set(apiPath, fs.files.get(apiPath).replace(PROJECT_REF, 'other'));
  if (scenario === 'wrongCa') fs.files.set(apiPath, fs.files.get(apiPath).replace('BEGIN CERTIFICATE', 'BEGIN INVALID'));
  await assert.rejects(prepare({ fs, root, parse, templateText: template, metadataText: metadata }));
  assert.equal(fs.files.has(bundlePath), false); checks++;
}

const edge = edgeHarness(preparedState.source, preparedState);
assert.equal((await edge.call({ op: 'preflight' })).json.code, 'READY');
assert.equal(edge.state.committed, 1); assert.equal(edge.state.login, false);
assert.equal(edge.state.config.hostname, HOST); assert.equal(edge.state.config.tls.enforce, true);
assert.equal(edge.state.config.tls.enabled, true); assert.equal(edge.state.config.controls.debug, false);
assert.equal(edge.state.queries.some((query) => query.includes('pg_stat_ssl')), false);
checks++;
assert.equal((await edge.call({ op: 'provision', verifier: preparedState.bundle.verifier })).json.code, 'PROVISIONED');
assert.equal(edge.state.login, true);
const alterations = edge.state.queries.filter((query) => query.startsWith('alter role')).length;
assert.equal((await edge.call({ op: 'provision', verifier: preparedState.bundle.verifier })).json.code, 'RUNTIME_ALREADY_LOGIN');
assert.equal(edge.state.queries.filter((query) => query.startsWith('alter role')).length, alterations); checks++;

for (const scenario of ['identity', 'database', 'creator', 'admin', 'tls', 'missingTls', 'transport', 'super', 'membershipAdmin', 'membershipSet', 'owner', 'directGrant', 'privilege']) {
  const candidate = edgeHarness(preparedState.source, preparedState); candidate.state.deny = scenario;
  const result = await candidate.call({ op: 'provision', verifier: preparedState.bundle.verifier });
  assert.equal(result.json.ok, false); assert.equal(candidate.state.committed, 0);
  assert.equal(candidate.state.queries.some((query) => query.startsWith('alter role')), false); checks++;
  if (['tls', 'missingTls', 'transport'].includes(scenario)) {
    assert.equal(result.json.code, 'ADMIN_TLS_REQUIRED');
    assert.equal(candidate.state.queries.length, 0);
  }
}
for (const scenario of ['unauthorized', 'wrongVerifier', 'unboundVerifier', 'oversized', 'arbitrarySql', 'expired', 'afterLock', 'afterPassword']) {
  const candidate = edgeHarness(preparedState.source, preparedState);
  let input = { op: 'provision', verifier: preparedState.bundle.verifier };
  if (scenario === 'wrongVerifier') input.verifier = input.verifier.replace('4096', '8192');
  if (scenario === 'unboundVerifier') {
    const index = input.verifier.indexOf(':') + 1;
    input.verifier = input.verifier.slice(0, index) + (input.verifier[index] === 'A' ? 'B' : 'A') + input.verifier.slice(index + 1);
  }
  if (scenario === 'oversized') input = { op: 'provision', verifier: 'x'.repeat(1000) };
  if (scenario === 'arbitrarySql') input.sql = 'select arbitrary';
  if (scenario === 'expired') candidate.state.time = preparedState.bundle.expiresAt;
  if (scenario === 'afterLock') candidate.state.expireAtLock = true;
  if (scenario === 'afterPassword') candidate.state.expireAtPassword = true;
  const result = await candidate.call(input, scenario === 'unauthorized' ? 'x'.repeat(43) : preparedState.bundle.token);
  assert.equal(result.json.ok, false); assert.equal(candidate.state.committed, 0); assert.equal(candidate.state.login, false);
  if (['unauthorized', 'wrongVerifier', 'unboundVerifier', 'oversized', 'arbitrarySql', 'expired'].includes(scenario)) assert.equal(candidate.state.connected, 0);
  checks++;
}
const requests = [];
const fetched = async (url, options) => {
  requests.push({ url, options });
  return Response.json({ ok: true, code: JSON.parse(options.body).op === 'preflight' ? 'READY' : 'PROVISIONED' });
};
for (const operation of ['preflight', 'provision']) {
  const result = await invoke({ operation, fs: preparedState.fs, root, parse,
    now: () => preparedState.now + 1, fetcher: fetched });
  assert.equal(result.ok, true); checks++;
}
assert.equal(requests.every(({ url, options }) => url === FUNCTION_URL && options.redirect === 'error'), true);
assert.equal(JSON.parse(requests[0].options.body).verifier, undefined);
assert.equal(requests[1].options.headers.authorization, `Bearer ${preparedState.bundle.token}`);
for (const scenario of ['expiredBundle', 'wrongRecovery', 'remoteDump', 'remoteOversized', 'remoteFailure']) {
  const candidate = await prepared();
  let fetcher = fetched;
  if (scenario === 'wrongRecovery') candidate.fs.files.set(recoveryPath, `PILOT_DATABASE_URL=invalid\n`);
  if (scenario === 'remoteDump') fetcher = async () => Response.json({ ok: false, code: 'OPERATION_FAILED', secret: 'synthetic' });
  if (scenario === 'remoteOversized') fetcher = async () => new Response('x'.repeat(2000));
  if (scenario === 'remoteFailure') fetcher = async () => { throw new Error('synthetic_private_error'); };
  await assert.rejects(invoke({ operation: 'provision', fs: candidate.fs, root, parse,
    now: () => scenario === 'expiredBundle' ? candidate.bundle.expiresAt : candidate.now + 1, fetcher }));
  assert.equal(candidate.fs.files.has(recoveryPath), true); checks++;
}
assert.equal(retired.includes('Deno.env'), false); assert.equal(retired.includes('import '), false);
assert.equal(retired.includes('status: 410'), true); checks++;
let retiredHandler;
vm.runInNewContext(transpile(retired), { Response,
  Deno: { serve: (value) => { retiredHandler = value; }, env: { get: () => { throw new Error('environment_access_forbidden'); } } },
  require: () => { throw new Error('driver_import_forbidden'); } });
const retiredResponse = retiredHandler(new Request(FUNCTION_URL));
assert.equal(retiredResponse.status, 410); assert.equal((await retiredResponse.json()).code, 'RETIRED'); checks++;
assert.equal(CA_SHA256.length, 64);
process.stdout.write(`${JSON.stringify({ syntheticChecksPassed: checks, realDatabaseConnections: 0,
  realEnvironmentFilesRead: 0, realSecretFilesWritten: 0, liveFunctionInvocations: 0 })}\n`);
