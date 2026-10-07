export type MapPoint = { lat: number; lng: number };
export function validMapPoint(point: MapPoint) {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}
export function decodeRoutePolyline(
  encoded: string | null | undefined,
): MapPoint[] {
  if (!encoded || encoded.length > 200_000) return [];
  const points: MapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  function delta() {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded!.length || shift > 30)
        throw new Error('Invalid polyline');
      byte = encoded!.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid polyline');
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  }
  try {
    while (index < encoded.length) {
      if (points.length >= 20_000) return [];
      lat += delta();
      lng += delta();
      const point = { lat: lat / 100_000, lng: lng / 100_000 };
      if (!validMapPoint(point)) return [];
      points.push(point);
    }
  } catch {
    return [];
  }
  return points;
}
