import { ConflictException } from '@nestjs/common';

export type RideStatus =
  | 'scheduled'
  | 'full'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

const transitions: Record<RideStatus, readonly RideStatus[]> = {
  scheduled: ['full', 'in_progress', 'cancelled'],
  full: ['scheduled', 'in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

export function assertRideTransition(from: RideStatus, to: RideStatus): void {
  if (!transitions[from]?.includes(to)) {
    throw new ConflictException(
      `Transición de viaje no permitida: ${from} -> ${to}`,
    );
  }
}
