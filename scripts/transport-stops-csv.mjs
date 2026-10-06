export const REQUIRED_HEADERS = [
  'external_id',
  'name',
  'address',
  'municipality',
  'latitude',
  'longitude',
  'stop_type',
  'active',
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV inválido: comillas sin cerrar');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(values => values.some(value => value.trim() !== ''));
}

const parseActive = (value, line) => {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`Línea ${line}: active debe ser true o false`);
};

export function parseTransportStopsCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('El CSV está vacío');
  const headers = rows[0].map(value => value.trim().replace(/^\uFEFF/, ''));
  if (
    headers.length !== REQUIRED_HEADERS.length ||
    headers.some((header, index) => header !== REQUIRED_HEADERS[index])
  ) {
    throw new Error(`Encabezados requeridos: ${REQUIRED_HEADERS.join(',')}`);
  }
  if (rows.length === 1) {
    throw new Error('El CSV no contiene paradas');
  }

  const externalIds = new Set();
  return rows.slice(1).map((values, rowIndex) => {
    const line = rowIndex + 2;
    if (values.length !== REQUIRED_HEADERS.length) {
      throw new Error(`Línea ${line}: se esperaban ${REQUIRED_HEADERS.length} columnas`);
    }
    const [
      externalId,
      name,
      address,
      municipality,
      latitudeRaw,
      longitudeRaw,
      stopType,
      activeRaw,
    ] = values.map(value => value.trim());
    if (!externalId || !name) {
      throw new Error(`Línea ${line}: external_id y name son obligatorios`);
    }
    if (externalIds.has(externalId)) {
      throw new Error(`Línea ${line}: external_id duplicado: ${externalId}`);
    }
    externalIds.add(externalId);
    const latitude = Number(latitudeRaw);
    const longitude = Number(longitudeRaw);
    if (
      latitudeRaw === '' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new Error(`Línea ${line}: latitude inválida`);
    }
    if (
      longitudeRaw === '' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error(`Línea ${line}: longitude inválida`);
    }
    if (!['general', 'official_boarding_zone'].includes(stopType)) {
      throw new Error(
        `Línea ${line}: stop_type debe ser general u official_boarding_zone`,
      );
    }
    return {
      external_id: externalId,
      name,
      address: address || null,
      municipality: municipality || null,
      latitude,
      longitude,
      source: 'krow_curated_csv',
      stop_type: stopType,
      active: parseActive(activeRaw, line),
    };
  });
}
