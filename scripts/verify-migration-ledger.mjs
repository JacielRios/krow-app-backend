import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Read-only guard for recovered, already-applied migration bodies. It neither
// connects to Supabase nor certifies a complete initial schema.
const normalize = (value) => value.replace(/\r\n/g, '\n').trimEnd();
let verified = 0;
for (const ledger of [
  'migration-ledger-202605.json',
  'migration-ledger-20260926.json',
  'migration-ledger-20261006.json',
  'migration-ledger-20261007.json',
  'migration-ledger-admin-20261007.json',
]) {
  const rows = JSON.parse(
    await readFile(new URL('../docs/' + ledger, import.meta.url), 'utf8'),
  );
  for (const row of rows) {
    if (
      !/^\d{14}$/.test(row.version) ||
      !/^[a-z0-9_]+$/.test(row.name) ||
      !Array.isArray(row.statements) ||
      row.statements.some((statement) => typeof statement !== 'string')
    ) {
      throw new Error(`Metadatos de migración inválidos: ${ledger}`);
    }
    const name = `${row.version}_${row.name}.sql`;
    const local = await readFile(
      new URL('../supabase/migrations/' + name, import.meta.url),
      'utf8',
    );
    const digest = (text) =>
      createHash('sha256').update(normalize(text)).digest('hex');
    if (digest(local) !== digest(row.statements.join('\n'))) {
      throw new Error(
        `La migración aplicada cambió respecto al ledger exportado: ${name}. Agrega una migración nueva para modificarla.`,
      );
    }
    verified++;
  }
}
console.log(
  `${verified} migraciones recuperadas coinciden con el ledger exportado.`,
);
