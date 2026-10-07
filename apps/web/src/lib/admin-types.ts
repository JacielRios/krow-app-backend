export type OperationalStatus = 'active' | 'suspended' | 'inactive';
export interface Compliance {
  state: 'ready' | 'attention';
  reasons: string[];
}
export interface Driver {
  driverId: string;
  userId: string;
  fullName: string;
  email: string;
  institutionalId: string | null;
  status: OperationalStatus;
  approvalStatus: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  rating: number | null;
  vehicleCount: number;
  compliance: Compliance;
}
export interface Vehicle {
  vehicleId: string;
  driverId: string;
  driverName: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  status: OperationalStatus;
  isActive: boolean;
  compliance: Compliance;
}
export type DocumentKind =
  | 'license'
  | 'identity'
  | 'registration'
  | 'insurance'
  | 'other';
export interface AdminDocument {
  documentId: string;
  driverId: string | null;
  vehicleId: string | null;
  driverName: string;
  kind: DocumentKind;
  status: 'pending' | 'approved' | 'rejected';
  uploadState: 'pending' | 'uploaded';
  expiresAt: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  reviewNotes: string | null;
  isExpired: boolean;
}
export interface DriverDetail extends Driver {
  vehicles: Vehicle[];
  documents: AdminDocument[];
}
export interface AdminUser {
  userId: string;
  fullName: string;
  email: string;
  institutionalId: string | null;
  hasDriverProfile: boolean;
}
export interface RidePlace {
  lat: number;
  lng: number;
  address: string;
  stopId?: string | null;
}
export interface AdminRide {
  rideId: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  plate: string;
  origin: RidePlace;
  destination: RidePlace;
  departureTime: string;
  createdAt: string;
  status: string;
  pricePerSeatCents: number;
  availableSeats: number;
  passengerCount: number;
  transportedPassengers: number;
  bookingCount: number;
  grossAmountCents: number;
  collectedAmountCents: number;
  pendingAmountCents: number;
}
export interface RideDetail extends AdminRide {
  startedAt: string | null;
  endedAt: string | null;
  route: {
    polyline?: string | null;
    distanceMeters?: number | null;
    durationSeconds?: number | null;
    provider?: string | null;
    version: number;
    stops: {
      stopId: string;
      name: string;
      address: string;
      lat: number;
      lng: number;
      order: number;
      isActive: boolean;
    }[];
  };
  passengers: {
    bookingId: string;
    userId: string;
    fullName: string;
    email: string;
    seats: number;
    status: string;
    amountCents: number;
    cashStatus: string;
    pickup: RidePlace;
    dropoff: RidePlace;
  }[];
  history: {
    status: string;
    previousStatus?: string | null;
    changedAt: string;
    reason?: string | null;
  }[];
}
export interface AuditEvent {
  auditId: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: { before?: unknown; after?: unknown };
  createdAt: string;
}
