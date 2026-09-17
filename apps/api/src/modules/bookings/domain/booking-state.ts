import { ConflictException } from '@nestjs/common';

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rejected'
  | 'in_progress'
  | 'completed';

const transitions: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['cancelled', 'in_progress'],
  in_progress: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function assertBookingTransition(
  from: BookingStatus,
  to: BookingStatus,
): void {
  if (!transitions[from]?.includes(to)) {
    throw new ConflictException(
      `Transición de reserva no permitida: ${from} -> ${to}`,
    );
  }
}
