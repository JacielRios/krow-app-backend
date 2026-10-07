import type {
  Coordinate,
  LocationSample,
  NavigationRoute,
} from './protocol.js';

const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = radians(b.lat - a.lat),
    dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function transmissionInterval(
  speedMps: number | null,
  nearStop: boolean,
): number {
  if (nearStop) return 1000;
  if (speedMps === null) return 2000;
  if (speedMps < 0.5) return 15000;
  return speedMps < 3 ? 5000 : 2000;
}

export function assessSample(
  sample: LocationSample,
  previous: LocationSample | null,
  now: number,
): 'accept' | 'historical' | 'reject' {
  const captured = Date.parse(sample.capturedAt);
  if (
    !Number.isFinite(captured) ||
    captured > now + 30000 ||
    captured < now - 86400000
  )
    return 'reject';
  if (
    ![sample.lat, sample.lng, sample.accuracyMeters].every(Number.isFinite) ||
    Math.abs(sample.lat) > 90 ||
    Math.abs(sample.lng) > 180 ||
    sample.accuracyMeters <= 0 ||
    sample.accuracyMeters > 5000
  )
    return 'reject';
  if (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0)
    return 'reject';
  if (
    sample.speedMps !== null &&
    (!Number.isFinite(sample.speedMps) ||
      sample.speedMps < 0 ||
      sample.speedMps > 80)
  )
    return 'reject';
  if (
    sample.headingDegrees !== null &&
    (!Number.isFinite(sample.headingDegrees) ||
      sample.headingDegrees < 0 ||
      sample.headingDegrees >= 360)
  )
    return 'reject';
  if (previous) {
    if (
      sample.sequence <= previous.sequence ||
      captured <= Date.parse(previous.capturedAt)
    )
      return 'historical';
    const elapsed = (captured - Date.parse(previous.capturedAt)) / 1000;
    const displacement = Math.max(
      0,
      distanceMeters(previous, sample) -
        previous.accuracyMeters -
        sample.accuracyMeters,
    );
    if (displacement / elapsed > 80) return 'reject';
  }
  return captured < now - 30000 ? 'historical' : 'accept';
}

/** Geometric progress is not road-network map matching; ambiguous fixes stay uncertain. */
export function routeProgress(
  point: Coordinate,
  route: NavigationRoute,
): { offRouteMeters: number; remainingMeters: number; etaSeconds: number } {
  const coordinates = route.geometry.coordinates;
  let length = 0,
    progress = 0,
    nearest = Infinity;
  for (let i = 1; i < coordinates.length; i++) {
    const a = { lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] };
    const b = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const scale = Math.cos(radians(point.lat));
    const ax = (a.lng - point.lng) * scale,
      ay = a.lat - point.lat;
    const dx = (b.lng - a.lng) * scale,
      dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
    );
    const projected = {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    };
    const distance = distanceMeters(point, projected),
      segment = distanceMeters(a, b);
    if (distance < nearest) {
      nearest = distance;
      progress = length + segment * t;
    }
    length += segment;
  }
  const fraction = length ? Math.max(0, 1 - progress / length) : 0;
  return {
    offRouteMeters: nearest,
    remainingMeters: Math.round(route.distanceMeters * fraction),
    etaSeconds: Math.round(route.durationSeconds * fraction),
  };
}

export function shouldReroute(
  currentSeconds: number,
  alternativeSeconds: number,
  reason: 'traffic' | 'closure' | 'deviation',
): boolean {
  return (
    reason !== 'traffic' ||
    (currentSeconds - alternativeSeconds > 120 &&
      currentSeconds - alternativeSeconds > currentSeconds * 0.1)
  );
}

/** Estimate to the rider's stop, interpolating time within each provider leg. */
export function progressToStop(
  point: Coordinate,
  route: NavigationRoute,
  stopId: string,
) {
  const target = route.stopProgress?.find((stop) => stop.stopId === stopId);
  if (!target) return null; // Old route versions do not imply a final-destination ETA.
  const progress = routeProgress(point, route);
  const travelled = Math.max(
    0,
    route.distanceMeters - progress.remainingMeters,
  );
  let distance = 0,
    elapsed = 0;
  for (const leg of route.legs) {
    if (travelled >= distance + leg.distanceMeters)
      elapsed += leg.durationSeconds;
    else {
      elapsed +=
        leg.distanceMeters > 0
          ? (Math.max(0, travelled - distance) / leg.distanceMeters) *
            leg.durationSeconds
          : 0;
      break;
    }
    distance += leg.distanceMeters;
  }
  return {
    offRouteMeters: progress.offRouteMeters,
    remainingMeters: Math.round(Math.max(0, target.distanceMeters - travelled)),
    etaSeconds: Math.round(Math.max(0, target.durationSeconds - elapsed)),
  };
}

export function detectDeviation(
  observations: Array<{ at: number; distance: number; accuracy: number }>,
): boolean {
  const last = observations.slice(-3);
  return (
    last.length === 3 &&
    last[2].at - last[0].at >= 5000 &&
    last.every(
      (o) => o.accuracy <= 50 && o.distance > Math.max(30, 2 * o.accuracy),
    )
  );
}
