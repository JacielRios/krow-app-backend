import * as fileSystem from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildScramVerifier, configureRuntimeUrl } from '../provision-pilot-password.mjs';
import { CA_SHA256, FUNCTION_SLUG, PROJECT_REF, HOST, ROLE, VERIFIER_PATTERN,
  workspaceRoot, requireFromApi, sha256, fail, exists, regularText,
  privatePaths, writeExclusive, validatePublicCa, withPrivateLock, runSafely } from './common.mjs';

// This prepares local files only. It never deploys, invokes, or connects to SQL.
export async function prepare({ fs = fileSystem, root = workspaceRoot,
  parse = requireFromApi('dotenv').parse, random = randomBytes,
  now = Date.now, onStage = () => {}, templateText, metadataText } = {}) {
  const paths = await privatePaths(root, fs);
  return withPrivateLock(paths, fs, async () => {
    onStage('local_validation');
    for (const path of [paths.recovery, paths.bundle, paths.source]) {
      if (await exists(fs, path)) fail('EXISTING_BOOTSTRAP_REQUIRES_REVIEW');
    }
    const initialEnv = await regularText(fs, paths.api);
    const values = parse(initialEnv);
    if (values.PILOT_DATABASE_URL?.trim()) fail('RUNTIME_URL_ALREADY_CONFIGURED');
    if (values.SUPABASE_URL !== `https://${PROJECT_REF}.supabase.co`) fail('PROJECT_URL_REQUIRED');
    const createdAt = now();
    const ca = validatePublicCa(values.PILOT_DATABASE_CA, createdAt);
    const password = random(32).toString('base64url');
    const token = random(32).toString('base64url');
    const verifier = buildScramVerifier(password, random(16));
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !VERIFIER_PATTERN.test(verifier)) fail('INVALID_GENERATED_CREDENTIAL');
    const runtimeUrl = `postgresql://${ROLE}.${PROJECT_REF}:${password}@${HOST}:5432/postgres`;
    configureRuntimeUrl(initialEnv, runtimeUrl, parse);
    const expiresAt = createdAt + 10 * 60 * 1000;
    const config = { bearerSha256: sha256(token), verifierSha256: sha256(verifier),
      expiresAt, ca, caSha256: CA_SHA256 };
    templateText ??= await fs.readFile(new URL('./index.template.ts', import.meta.url), 'utf8');
    metadataText ??= await fs.readFile(new URL('./metadata.ts', import.meta.url), 'utf8');
    const marker = '/*__PUBLIC_BOOTSTRAP_CONFIG__*/null';
    if (templateText.split(marker).length !== 2) fail('INVALID_TEMPLATE');
    const source = templateText.replace(marker, JSON.stringify(config));
    // Defense against accidentally embedding any private credential in MCP source.
    for (const secret of [password, token, verifier, runtimeUrl]) {
      if (source.includes(secret) || metadataText.includes(secret)) fail('PRIVATE_DATA_IN_SOURCE');
    }
    if (await regularText(fs, paths.api) !== initialEnv) fail('API_ENV_CHANGED');
    onStage('saving_private_recovery');
    // Recovery exists before any later remote operation. Partial preparation is
    // deliberately retained for review; no subsequent run silently rotates it.
    await writeExclusive(fs, paths.recovery, `# Private credential; never print or upload.\nPILOT_DATABASE_URL=${runtimeUrl}\n`);
    await writeExclusive(fs, paths.bundle, `${JSON.stringify({ version: 1, project: PROJECT_REF,
      function: FUNCTION_SLUG, createdAt, expiresAt, token, verifier })}\n`);
    await fs.mkdir(paths.source, { mode: 0o700 });
    await writeExclusive(fs, resolve(paths.source, 'index.ts'), source);
    await writeExclusive(fs, resolve(paths.source, 'metadata.ts'), metadataText);
    await writeExclusive(fs, resolve(paths.source, 'deno.json'),
      '{"imports":{"@db/postgres":"jsr:@db/postgres@0.19.5"},"compilerOptions":{"strict":true}}\n');
    onStage('prepared');
    return { ok: true, prepared: true, deployed: false, project: PROJECT_REF,
      function: FUNCTION_SLUG, expiresAt: new Date(expiresAt).toISOString() };
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runSafely(async (onStage) => {
    if (process.argv.length !== 2) fail('INVALID_ARGUMENTS');
    return prepare({ onStage });
  });
}
