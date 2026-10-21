export interface StopCoordinates {
  latitude: number;
  longitude: number;
}

/** Google references remain transient until the administrator confirms a KROW record. */
export interface GoogleStopReference extends StopCoordinates {
  placeId: string;
  name: string;
  address: string;
}

export interface TransportStop extends StopCoordinates {
  stopId: string;
  externalId: string;
  name: string;
  address: string | null;
  municipality: string | null;
  stopType: 'general' | 'official_boarding_zone' | 'dropoff_only';
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
  code?: string;
}

export interface StopSuggestions {
  catalogVersion?: string | null;
  values: {
    externalId: string;
    name: string;
    address: string;
    municipality: string;
    latitude: number;
    longitude: number;
    stopType: 'dropoff_only';
    direction: string;
    corridorId: string;
    stopOrder: number | null;
  };
  warnings: string[];
  orderSource: 'catalog_geometry' | null;
  directionSource: 'google_reference_label' | 'catalog' | null;
  shiftedStops: number;
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
