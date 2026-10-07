import { trackingFreshness, type LocationSample } from './pilot.domain.js';
type Point = { lat: number; lng: number };
// An estimate based on provider duration and route distance, not turn-by-turn
// navigation. Reject inaccurate/off-route fixes rather than fabricate an ETA.
export function approximateEta(
  polyline: string,
  durationSeconds: number,
  position: LocationSample | null,
  target: Point,
  now = Date.now(),
): number | null {
  if (
    !position ||
    trackingFreshness(position, now).state !== 'live' ||
    position.accuracy > 100 ||
    durationSeconds <= 0
  )
    return null;
  const points: Point[] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  try {
    const read = () => {
      let result = 0,
        shift = 0,
        value = 0;
      do {
        if (index >= polyline.length || shift > 30)
          throw new Error('Invalid polyline');
        value = polyline.charCodeAt(index++) - 63;
        if (value < 0 || value > 63) throw new Error('Invalid polyline');
        result |= (value & 31) << shift;
        shift += 5;
      } while (value >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < polyline.length) {
      lat += read();
      lng += read();
      points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
  } catch {
    return null;
  }
  if (points.length < 2) return null;
  const scale = Math.cos((position.lat * Math.PI) / 180);
  const vector = (p: Point) => ({
    x: p.lng * 111320 * scale,
    y: p.lat * 111320,
  });
  const project = (p: Point) => {
    const v = vector(p);
    let total = 0,
      best = { distance: Infinity, along: 0 };
    for (let i = 1; i < points.length; i++) {
      const a = vector(points[i - 1]),
        b = vector(points[i]);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      const t = len
        ? Math.max(
            0,
            Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / (len * len)),
          )
        : 0;
      const distance = Math.hypot(v.x - a.x - t * dx, v.y - a.y - t * dy);
      if (distance < best.distance) best = { distance, along: total + t * len };
      total += len;
    }
    return { ...best, total };
  };
  const here = project(position),
    there = project(target);
  if (
    here.distance > 150 ||
    there.distance > 150 ||
    here.total < 1 ||
    there.along + 100 < here.along
  )
    return null;
  return Math.max(
    0,
    Math.round(
      (durationSeconds * Math.max(0, there.along - here.along)) / here.total,
    ),
  );
}
