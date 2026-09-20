import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTransportStopsCsv } from './transport-stops-csv.mjs';

const header =
  'external_id,name,address,municipality,latitude,longitude,active\n';

test('acepta comas escapadas y normaliza una parada', () => {
  const [stop] = parseTransportStopsCsv(
    header +
      'KROW-1,"Parada, Centro","Av. Uno 10",Guadalupe,25.66,-100.24,true\n',
  );
  assert.equal(stop.name, 'Parada, Centro');
  assert.equal(stop.active, true);
  assert.equal(stop.source, 'krow_curated_csv');
});

test('rechaza coordenadas inválidas', () => {
  assert.throws(
    () =>
      parseTransportStopsCsv(
        header + 'KROW-1,Parada,Dirección,Guadalupe,125,-100.24,true\n',
      ),
    /latitude inválida/,
  );
});

test('rechaza una coordenada vacía en lugar de convertirla en cero', () => {
  assert.throws(
    () =>
      parseTransportStopsCsv(
        header + 'KROW-1,Parada,Dirección,Guadalupe,,-100.24,true\n',
      ),
    /latitude inválida/,
  );
});

test('rechaza external_id duplicado para mantener upserts deterministas', () => {
  assert.throws(
    () =>
      parseTransportStopsCsv(
        header +
          'KROW-1,Primera,Dirección,Guadalupe,25.66,-100.24,true\n' +
          'KROW-1,Segunda,Dirección,Guadalupe,25.67,-100.25,false\n',
      ),
    /external_id duplicado/,
  );
});

test('una segunda lectura produce exactamente el mismo payload idempotente', () => {
  const csv =
    header + 'KROW-1,Parada,Dirección,Guadalupe,25.66,-100.24,false\n';
  assert.deepEqual(parseTransportStopsCsv(csv), parseTransportStopsCsv(csv));
});

test('no acepta un CSV sin filas de catálogo', () => {
  assert.throws(() => parseTransportStopsCsv(header), /no contiene paradas/);
});
