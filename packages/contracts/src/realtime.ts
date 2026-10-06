/** Version 2 wire contract. Distances are metres, durations seconds, dates UTC ISO. */
export interface Coordinate {
  lat: number;
  lng: number;
}
export interface LocationSample extends Coordinate {
  sessionId: string;
  sequence: number;
  capturedAt: string;
  accuracyMeters: number;
  speedMps: number | null;
  headingDegrees: number | null;
}
export interface VehiclePosition extends LocationSample {
  receivedAt: string;
  quality: 'observed' | 'uncertain';
}
export interface NavigationRoute {
  provider: 'mapbox';
  calculatedAt: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distanceMeters: number;
  durationSeconds: number;
  stopIds: string[];
  legs: Array<{
    distanceMeters: number;
    durationSeconds: number;
    steps: unknown[];
  }>;
  trafficAvailable: boolean;
  /** Cumulative provider distances/times, including an optional vehicle origin leg. */
  stopProgress?: Array<{
    stopId: string;
    distanceMeters: number;
    durationSeconds: number;
  }>;
}
export interface RuntimeStop extends Coordinate {
  stopId: string;
  order: number;
  address: string;
  state:
    | 'pending'
    | 'approaching'
    | 'arrived'
    | 'servicing'
    | 'departed'
    | 'skipped';
  pickups: number;
  dropoffs: number;
}
export interface RuntimeBooking {
  bookingId: string;
  pickupStopId: string;
  dropoffStopId: string;
  seats: number;
  status:
    | 'pending'
    | 'confirmed'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'rejected'
    | 'no_show'
    | 'interrupted';
}
export type RuntimeAction =
  | 'start'
  | 'complete'
  | 'interrupt'
  | 'cancel'
  | 'arrive'
  | 'depart'
  | 'board'
  | 'dropoff'
  | 'no_show'
  | 'accept_booking'
  | 'reject_booking'
  | 'cancel_booking';
export interface RuntimeCommand {
  commandId: string;
  expectedVersion: number;
  action: RuntimeAction;
  stopId?: string;
  bookingId?: string;
  reason?: string;
}
export interface RuntimeEvent {
  eventId: string;
  rideId: string;
  version: number;
  type: string;
  occurredAt: string;
  /** Business events carry invalidations. Fetch an authorized snapshot for details. */
}
export interface RuntimeSnapshot {
  rideId: string;
  version: number;
  role: 'driver' | 'passenger';
  state:
    | 'scheduled'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'interrupted';
  route: NavigationRoute | null;
  routeVersion: number;
  committedPolyline: string | null;
  committedProvider: string | null;
  stops: RuntimeStop[];
  bookings: RuntimeBooking[];
  position: VehiclePosition | null;
  tracking: 'live' | 'stale' | 'unavailable';
  generatedAt: string;
  nextStopId: string | null;
  remainingMeters: number | null;
  etaSeconds: number | null;
  etaConfidence: 'low' | 'medium';
}
