import { readFile, writeFile } from 'node:fs/promises';
const source = new URL(
  '../apps/api/src/modules/ride-runtime/domain/protocol.ts',
  import.meta.url,
);
const copies = [
  new URL('../packages/contracts/src/realtime.ts', import.meta.url),
  new URL(
    '../../krow-app-mobile/src/features/ride-runtime/protocol.ts',
    import.meta.url,
  ),
];
const contract = await readFile(source, 'utf8');
for (const file of copies) {
  if (process.argv.includes('--write')) await writeFile(file, contract);
  else if (
    (await readFile(file, 'utf8')).replaceAll('\r\n', '\n') !==
    contract.replaceAll('\r\n', '\n')
  )
    throw new Error(`Runtime contract drift: ${file.pathname}`);
}
console.log('Runtime contracts synchronized.');
