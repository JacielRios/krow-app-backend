import * as fileSystem from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_REF = 'yyjbqzsokxpzhevpanyq';
export const HOST = 'aws-1-us-east-1.pooler.supabase.com';
export const ROLE = 'krow_pilot_runtime';
export const GROUP = 'krow_pilot_service';
export const FUNCTION_SLUG = 'krow-pilot-private-bootstrap';
export const FUNCTION_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_SLUG}`;
export const CA_SHA256 = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';
export const VERIFIER_PATTERN = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
export const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const requireFromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export class BootstrapFault extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
export const fail = (reason) => { throw new BootstrapFault(reason); };

export async function exists(fs, path) {
  try { await fs.lstat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
export async function regularText(fs, path) {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_FILE_PATH');
  return fs.readFile(path, 'utf8');
}
export async function writeExclusive(fs, path, value) {
  const file = await fs.open(path, 'wx', 0o600);
  try { await file.writeFile(value, 'utf8'); await file.sync(); }
  finally { await file.close(); }
}
export async function privatePaths(root = workspaceRoot, fs = fileSystem) {
  const directory = resolve(root, '.temp/pilot-provision');
  const resolvedRoot = await fs.realpath(root);
  for (const path of [root, resolve(root, '.temp'), directory, resolve(root, 'apps/api')]) {
    const stat = await fs.lstat(path);
    const inside = relative(resolvedRoot, await fs.realpath(path));
    if (!stat.isDirectory() || stat.isSymbolicLink() || inside.startsWith('..') || isAbsolute(inside)) {
      fail('UNSAFE_FILE_PATH');
    }
  }
  return {
    directory, api: resolve(root, 'apps/api/.env'),
    bundle: resolve(directory, 'edge-request.json'),
    recovery: resolve(directory, 'runtime.env'),
    lock: resolve(directory, 'provision.lock'),
    source: resolve(directory, 'edge-source'),
  };
}
export function validatePublicCa(raw, now = Date.now()) {
  const ca = raw?.replace(/\\n/g, '\n').trim();
  const certificates = ca?.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!ca || certificates?.length !== 1 || ca.replace(certificates[0], '').trim()) fail('VERIFIED_CA_REQUIRED');
  let certificate;
  try { certificate = new X509Certificate(ca); } catch { fail('VERIFIED_CA_REQUIRED'); }
  if (certificate.fingerprint256.replaceAll(':', '') !== CA_SHA256 || !certificate.ca ||
      Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    fail('VERIFIED_CA_REQUIRED');
  }
  return ca;
}
export async function withPrivateLock(paths, fs, action) {
  if (await exists(fs, paths.lock)) fail('PROVISION_LOCK_PRESENT');
  await writeExclusive(fs, paths.lock, 'KROW private credential bootstrap in progress.\n');
  try { return await action(); }
  finally { await fs.unlink(paths.lock).catch(() => {}); }
}
export async function runSafely(action) {
  let stage = 'input';
  try {
    const result = await action((name) => { stage = name; });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, stage,
      reason: error instanceof BootstrapFault ? error.reason : 'OPERATION_FAILED' })}\n`);
    process.exitCode = 1;
  }
}
