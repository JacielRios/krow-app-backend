export type Point = { lat: number; lng: number };

// Distances describe proximity, never an estimated walk or a safe crossing.
export function distanceMeters(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const value =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return (
    6_371_008.8 *
    2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)))
  );
}

export function projectToPath(point: Point, path: Point[]) {
  let traveled = 0;
  let best = { progress: 0, distance: Infinity };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1],
      b = path[index];
    const xScale = Math.cos((point.lat * Math.PI) / 180);
    const dx = (b.lng - a.lng) * xScale,
      dy = b.lat - a.lat;
    const denom = dx * dx + dy * dy;
    const t =
      denom === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.lng - a.lng) * xScale * dx + (point.lat - a.lat) * dy) /
                denom,
            ),
          );
    const projected = {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    };
    const segment = distanceMeters(a, b);
    const distance = distanceMeters(point, projected);
    if (distance < best.distance)
      best = { progress: traveled + segment * t, distance };
    traveled += segment;
  }
  return { ...best, total: traveled };
}
