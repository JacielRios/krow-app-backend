export interface StopCoordinates {
  latitude: number;
  longitude: number;
}

export interface TransportStop extends StopCoordinates {
  stopId: string;
  externalId: string;
  name: string;
  address: string | null;
  municipality: string | null;
  stopType: 'general' | 'official_boarding_zone';
  active: boolean;
  corridorId: string | null;
  stopOrder: number | null;
  direction: string | null;
}

export interface TransportCorridor {
  corridorId: string;
  name: string;
  direction: string | null;
  active: boolean;
}

export function validStopCoordinates(point: StopCoordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** The existing save endpoint requires all editable fields, also for status changes. */
export function transportStopPayload(
  stop: TransportStop,
  active = stop.active,
) {
  return {
    externalId: stop.externalId,
    name: stop.name,
    address: stop.address ?? '',
    municipality: stop.municipality ?? '',
    latitude: stop.latitude,
    longitude: stop.longitude,
    stopType: stop.stopType,
    active,
    corridorId: stop.corridorId,
    stopOrder: stop.stopOrder,
    direction: stop.direction,
  };
}
