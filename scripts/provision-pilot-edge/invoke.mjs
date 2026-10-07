import * as fileSystem from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildScramVerifier, validateRecoveryUrl } from '../provision-pilot-password.mjs';
import { FUNCTION_SLUG, FUNCTION_URL, PROJECT_REF, VERIFIER_PATTERN,
  workspaceRoot, requireFromApi, fail, regularText, privatePaths,
  withPrivateLock, runSafely } from './common.mjs';

const RESPONSE_CODES = new Set(['READY', 'PROVISIONED', 'UNAUTHORIZED', 'EXPIRED',
  'ADMIN_TLS_REQUIRED',
  'INVALID_REQUEST', 'INVALID_VERIFIER', 'CONFIGURATION_REQUIRED', 'UNEXPECTED_ADMIN_IDENTITY',
  'UNEXPECTED_ADMIN_DATABASE', 'DATABASE_LINK_TLS_REQUIRED',
  'ADMIN_PERMISSION_REQUIRED', 'PREPARED_ROLES_REQUIRED', 'UNSAFE_ROLE',
  'RUNTIME_ALREADY_LOGIN', 'UNSAFE_MEMBERSHIP', 'UNEXPECTED_ROLE_PRIVILEGES',
  'PILOT_PRIVILEGES_REQUIRED', 'OPERATION_FAILED', 'RETIRED']);

export async function invoke({ operation, fs = fileSystem, root = workspaceRoot,
  parse = requireFromApi('dotenv').parse, fetcher = globalThis.fetch,
  now = Date.now, onStage = () => {} } = {}) {
  if (!['preflight', 'provision'].includes(operation)) fail('INVALID_ARGUMENTS');
  const paths = await privatePaths(root, fs);
  return withPrivateLock(paths, fs, async () => {
    onStage('private_input_validation');
    let bundle;
    try { bundle = JSON.parse(await regularText(fs, paths.bundle)); }
    catch { fail('INVALID_PRIVATE_BUNDLE'); }
    const expectedKeys = ['createdAt', 'expiresAt', 'function', 'project', 'token', 'verifier', 'version'];
    if (!bundle || Object.keys(bundle).sort().join(',') !== expectedKeys.join(',') ||
        bundle.version !== 1 || bundle.project !== PROJECT_REF || bundle.function !== FUNCTION_SLUG ||
        !/^[A-Za-z0-9_-]{43}$/.test(bundle.token) || !VERIFIER_PATTERN.test(bundle.verifier) ||
        !Number.isSafeInteger(bundle.createdAt) || !Number.isSafeInteger(bundle.expiresAt) ||
        bundle.expiresAt - bundle.createdAt !== 600000 || bundle.createdAt > now()) {
      fail('INVALID_PRIVATE_BUNDLE');
    }
    if (now() >= bundle.expiresAt) fail('BOOTSTRAP_EXPIRED');
    const recovery = parse(await regularText(fs, paths.recovery));
    if (Object.keys(recovery).length !== 1) fail('INVALID_RECOVERY_FILE');
    const password = validateRecoveryUrl(recovery.PILOT_DATABASE_URL);
    const salt = Buffer.from(bundle.verifier.split(':')[1].split('$')[0], 'base64');
    const expected = Buffer.from(buildScramVerifier(password, salt));
    const supplied = Buffer.from(bundle.verifier);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail('RECOVERY_CREDENTIAL_MISMATCH');
    onStage(operation === 'preflight' ? 'remote_preflight' : 'remote_provision');
    // Secrets are constructed in memory from ignored files, never CLI arguments.
    const response = await fetcher(FUNCTION_URL, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${bundle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(operation === 'preflight' ? { op: 'preflight' }
        : { op: 'provision', verifier: bundle.verifier }), signal: AbortSignal.timeout(25000) });
    const contentLength = response.headers.get('content-length');
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1024)) fail('INVALID_REMOTE_RESPONSE');
    // Bound streaming responses too, including responses without Content-Length.
    const reader = response.body?.getReader();
    if (!reader) fail('INVALID_REMOTE_RESPONSE');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) fail('INVALID_REMOTE_RESPONSE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('INVALID_REMOTE_RESPONSE'); }
    if (!result || Object.keys(result).sort().join(',') !== 'code,ok' ||
        typeof result.ok !== 'boolean' || !RESPONSE_CODES.has(result.code)) fail('INVALID_REMOTE_RESPONSE');
    const success = operation === 'preflight' ? 'READY' : 'PROVISIONED';
    if (!response.ok || result.ok !== true || result.code !== success) fail(result.code);
    onStage(operation === 'preflight' ? 'preflight_complete' : 'provision_complete');
    return { ok: true, operation, code: success,
      ...(operation === 'provision' ? { runtimeVerificationRequired: true, retirementRequired: true } : {}) };
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runSafely(async (onStage) => {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--preflight', '--provision'].includes(args[0])) fail('INVALID_ARGUMENTS');
    return invoke({ operation: args[0].slice(2), onStage });
  });
}
