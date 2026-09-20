export type LineStringGeoJson = {
  type: 'LineString';
  coordinates: [number, number][];
};

export function decodeGooglePolyline(encoded: string): LineStringGeoJson {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const lat = decodeValue(encoded, index);
    index = lat.nextIndex;
    latitude += lat.delta;

    const lng = decodeValue(encoded, index);
    index = lng.nextIndex;
    longitude += lng.delta;
    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }

  if (coordinates.length < 2) {
    throw new Error('La ruta calculada no contiene suficientes puntos');
  }
  return { type: 'LineString', coordinates };
}

function decodeValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte: number;
  do {
    if (index >= encoded.length) {
      throw new Error('Polyline de Google incompleto');
    }
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    delta: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index,
  };
}
