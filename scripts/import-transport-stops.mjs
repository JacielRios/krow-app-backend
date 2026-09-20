import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransportStopsCsv } from './transport-stops-csv.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // El entorno de despliegue puede inyectar variables sin un archivo .env.
}

const argumentsList = process.argv.slice(2);
const dryRun = argumentsList.includes('--dry-run');
const csvArgument = argumentsList.find(argument => !argument.startsWith('--'));

if (!csvArgument) {
  throw new Error(
    'Uso: npm run stops:import -- <archivo.csv> [--dry-run]',
  );
}

const csvPath = resolve(csvArgument);
const rows = parseTransportStopsCsv(await readFile(csvPath, 'utf8'));

if (dryRun) {
  console.log(`CSV válido: ${rows.length} paradas listas para importar.`);
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios para importar. La clave anon no puede modificar el catálogo.',
  );
}

const chunkSize = 500;
for (let offset = 0; offset < rows.length; offset += chunkSize) {
  const updatedAt = new Date().toISOString();
  const chunk = rows
    .slice(offset, offset + chunkSize)
    .map(row => ({ ...row, updated_at: updatedAt }));
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/rest/v1/transport_stops?on_conflict=external_id`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Supabase rechazó el bloque ${offset + 1}-${offset + chunk.length}: ${await response.text()}`,
    );
  }
}

console.log(
  `Importación completada: ${rows.length} paradas creadas o actualizadas por external_id.`,
);
