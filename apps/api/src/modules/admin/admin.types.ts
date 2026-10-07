import type { AdminStatus } from './admin.dto.js';
export interface AdminCompliance {
  state: 'ready' | 'attention';
  reasons: string[];
}
export interface AdminDriver {
  driverId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  institutionalId: string | null;
  licenseNumber: string;
  licenseExpiresAt: string;
  approvalStatus: 'approved' | 'pending' | 'rejected' | 'suspended';
  status: AdminStatus;
  rating: number | null;
  vehicleCount: number;
  compliance: AdminCompliance;
}
export interface AdminVehicle {
  vehicleId: string;
  driverId: string;
  driverName: string | null;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  status: AdminStatus;
  isActive: boolean;
  compliance: AdminCompliance;
}
export interface AdminDocument {
  documentId: string;
  driverId: string;
  vehicleId: string | null;
  driverName: string | null;
  kind: string;
  status: 'pending' | 'approved' | 'rejected';
  uploadState: 'pending' | 'uploaded';
  expiresAt: string | null;
  isExpired: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  reviewNotes: string | null;
  createdAt: string;
}
export interface AdminDriverDetail extends AdminDriver {
  vehicles: AdminVehicle[];
  documents: AdminDocument[];
}
export interface AdminCoordinate {
  lat: number;
  lng: number;
  address: string | null;
}
export interface AdminRide {
  rideId: string;
  driverId: string;
  driverName: string | null;
  vehicleId: string;
  plate: string;
  origin: AdminCoordinate;
  destination: AdminCoordinate;
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
export interface AdminRoute {
  polyline: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  provider: string | null;
  version: number;
  stops: (AdminCoordinate & {
    stopId: string;
    name: string;
    order: number;
    isActive: boolean;
  })[];
}
export interface AdminRideHistory {
  status: string;
  previousStatus: string | null;
  changedAt: string;
  reason: string | null;
}
export interface AdminPassenger {
  bookingId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  seats: number;
  status: string;
  amountCents: number | null;
  cashStatus: 'pending' | 'collected' | 'void';
  pickup: AdminCoordinate & { stopId: string };
  dropoff: AdminCoordinate & { stopId: string };
}
export interface AdminRideDetail extends AdminRide {
  route: AdminRoute;
  passengers: AdminPassenger[];
  history: AdminRideHistory[];
  startedAt: string | null;
  endedAt: string | null;
}
