import { createHash } from 'node:crypto';
import {
  distanceMeters,
  projectToPath,
} from '../routes/domain/corridor-geometry.js';

type Corridor = {
  corridorId: string;
  code: string;
  name: string;
  direction: string | null;
  active: boolean;
};
type CatalogStop = {
  stopId: string;
  externalId: string;
  latitude: number;
  longitude: number;
  active: boolean;
  corridorId: string | null;
  stopOrder: number | null;
  updatedAt?: string | null;
};
type Geocode = {
  formattedAddress: string;
  municipality?: string | null;
  road?: string | null;
  streetNumber?: string | null;
  neighborhood?: string | null;
};
type Input = {
  latitude: number;
  longitude: number;
  referenceName?: string;
  corridorId?: string;
};
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(avenida|av|ave|avda)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
const point = (stop: { latitude: number; longitude: number }) => ({
  lat: stop.latitude,
  lng: stop.longitude,
});

/** Names can state a bus service direction, never prove one-way traffic or a safe curb. */
function referenceDirection(name: string) {
  const match = name
    .toUpperCase()
    .match(/\b(PTE|OTE|NTE|SUR)\s*[-–—]\s*(PTE|OTE|NTE|SUR)\b/);
  const labels: Record<string, string> = {
    PTE: 'Poniente',
    OTE: 'Oriente',
    NTE: 'Norte',
    SUR: 'Sur',
  };
  return match && match[1] !== match[2]
    ? `${labels[match[1]]} a ${labels[match[2]]}`
    : null;
}

export function suggestStop(
  input: Input,
  geocode: Geocode | null,
  corridors: Corridor[],
  catalog: CatalogStop[],
  geocodeFailed = false,
) {
  const warnings: string[] = [];
  const road = normalize(geocode?.road ?? '');
  const reference = normalize(input.referenceName ?? '');
  const matches = corridors.filter(
    (corridor) =>
      corridor.active &&
      (road === normalize(corridor.name) ||
        // A Google bus label can identify the avenue even if geocoding picks a side street.
        (normalize(corridor.name).length >= 6 &&
          reference.includes(normalize(corridor.name)))),
  );
  const corridor = input.corridorId
    ? corridors.find(
        (item) => item.active && item.corridorId === input.corridorId,
      )
    : matches.length === 1
      ? matches[0]
      : undefined;
  const direction =
    referenceDirection(input.referenceName ?? '') ?? corridor?.direction ?? '';
  const ordered = catalog
    .filter(
      (stop) =>
        stop.active &&
        stop.corridorId === corridor?.corridorId &&
        stop.stopOrder != null,
    )
    .sort((a, b) => a.stopOrder! - b.stopOrder!);
  let stopOrder: number | null = null;
  if (corridor && ordered.length >= 2) {
    const path = ordered.map(point);
    const projection = projectToPath(point(input), path);
    const closeToExisting = ordered.some(
      (stop) => distanceMeters(point(stop), point(input)) < 12,
    );
    if (projection.distance <= 70 && !closeToExisting) {
      const after = ordered.find(
        (stop) =>
          projectToPath(point(stop), path).progress > projection.progress + 2,
      );
      stopOrder = after?.stopOrder ?? ordered.at(-1)!.stopOrder! + 1;
      // Opposite service directions must be reviewed, never inserted into the outbound sequence.
      const dx = path.at(-1)!.lng - path[0].lng,
        dy = path.at(-1)!.lat - path[0].lat;
      if (
        (direction === 'Poniente a Oriente' && dx <= 0) ||
        (direction === 'Oriente a Poniente' && dx >= 0) ||
        (direction === 'Norte a Sur' && dy >= 0) ||
        (direction === 'Sur a Norte' && dy <= 0)
      ) {
        stopOrder = null;
        warnings.push(
          'La dirección de la referencia difiere del orden actual de la avenida. Confirma el sentido y el orden manualmente.',
        );
      }
    }
  }
  if (!corridor)
    warnings.push(
      'No se identificó una única avenida registrada. Selecciónala para habilitar esta parada en nuevas rutas.',
    );
  if (!direction)
    warnings.push(
      'No hay un sentido confirmado. Google no proporciona el sentido legal de circulación mediante geocodificación inversa.',
    );
  else
    warnings.push(
      'Confirma el sentido y el lado de la vialidad: la referencia o el catálogo no acreditan por sí solos que sea seguro detenerse.',
    );
  if (corridor && stopOrder == null)
    warnings.push(
      'No se pudo situar el punto con certeza dentro del orden de la avenida. Indica su posición manualmente.',
    );
  if (!geocode?.municipality)
    warnings.push(
      'Google no devolvió un municipio explícito. Complétalo o confírmalo manualmente.',
    );
  if (geocodeFailed)
    warnings.push(
      'No se pudo consultar la dirección en Google. Puedes completar los datos manualmente o reintentar.',
    );
  const nearby = catalog.find(
    (stop) => distanceMeters(point(stop), point(input)) < 5,
  );
  if (nearby)
    warnings.push(
      `Ya hay una parada a menos de 5 m (${nearby.externalId}). Revisa el catálogo para evitar duplicados.`,
    );
  const name = (
    input.referenceName?.trim() ||
    [geocode?.road, geocode?.streetNumber || geocode?.neighborhood]
      .filter(Boolean)
      .join(' · ') ||
    `Descenso ${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)}`
  ).slice(0, 160);
  const existing = ordered
    .map((stop) => stop.externalId)
    .filter((id) => id.startsWith('krow-itnl-'))
    .map((id) => id.split('-'));
  const common: string[] = [];
  if (existing.length)
    for (let index = 0; index < existing[0].length; index++) {
      if (!existing.every((tokens) => tokens[index] === existing[0][index]))
        break;
      common.push(existing[0][index]);
    }
  const prefix =
    common.length >= 3
      ? common.join('-')
      : `krow-itnl${corridor ? `-${corridor.code}` : ''}`;
  const suffix = createHash('sha256')
    .update(`${input.latitude.toFixed(6)},${input.longitude.toFixed(6)}`)
    .digest('hex')
    .slice(0, 10);
  const base = `${prefix.slice(0, 85)}-descenso-${suffix}`;
  let externalId = base;
  for (
    let index = 2;
    catalog.some((stop) => stop.externalId === externalId);
    index++
  )
    externalId = `${base}-${index}`;
  return {
    catalogVersion: corridor
      ? createHash('md5')
          .update(
            ordered
              .slice()
              .sort((a, b) => a.stopId.localeCompare(b.stopId))
              .map(
                (stop) =>
                  `${stop.stopId}:${stop.stopOrder}:${stop.updatedAt ? new Date(stop.updatedAt).getTime() : ''}`,
              )
              .join('|'),
          )
          .digest('hex')
      : null,
    values: {
      externalId,
      name,
      address: geocode?.formattedAddress ?? '',
      municipality: geocode?.municipality ?? '',
      latitude: input.latitude,
      longitude: input.longitude,
      stopType: 'dropoff_only' as const,
      direction,
      corridorId: corridor?.corridorId ?? '',
      stopOrder,
    },
    warnings,
    orderSource: stopOrder == null ? null : 'catalog_geometry',
    directionSource: referenceDirection(input.referenceName ?? '')
      ? 'google_reference_label'
      : corridor?.direction
        ? 'catalog'
        : null,
    shiftedStops:
      stopOrder == null
        ? 0
        : ordered.filter((stop) => stop.stopOrder! >= stopOrder).length,
  };
}
