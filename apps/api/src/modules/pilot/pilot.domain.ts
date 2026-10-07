import { BadRequestException, ConflictException } from '@nestjs/common';

export interface LocationSample {
  seq: number;
  capturedAt: string;
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number;
  heading?: number;
}
export function validateSample(
  sample: LocationSample,
  lastSeq: number,
  previousAt?: string,
  now = Date.now(),
) {
  const timestamp = Date.parse(sample.capturedAt);
  if (
    !Number.isSafeInteger(sample.seq) ||
    sample.seq < 0 ||
    !Number.isFinite(timestamp) ||
    timestamp > now + 5000 ||
    timestamp < now - 600_000 ||
    !Number.isFinite(sample.lat) ||
    Math.abs(sample.lat) > 90 ||
    !Number.isFinite(sample.lng) ||
    Math.abs(sample.lng) > 180 ||
    !Number.isFinite(sample.accuracy) ||
    sample.accuracy < 0 ||
    sample.accuracy > 200 ||
    (sample.speed != null &&
      (!Number.isFinite(sample.speed) ||
        sample.speed < 0 ||
        sample.speed > 80)) ||
    (sample.heading != null &&
      (!Number.isFinite(sample.heading) ||
        sample.heading < 0 ||
        sample.heading >= 360))
  )
    throw new BadRequestException(
      'Ubicación inválida, imprecisa o fuera de tiempo',
    );
  // Retransmission after a lost HTTP response is safe and acknowledged.
  return (
    sample.seq > lastSeq && (!previousAt || timestamp > Date.parse(previousAt))
  );
}
export function nextBookingState(
  current: string,
  action: 'board' | 'dropoff' | 'no-show',
) {
  const target =
    action === 'board'
      ? 'in_progress'
      : action === 'dropoff'
        ? 'completed'
        : 'no_show';
  if (current === target) return target;
  if (
    (action === 'dropoff' && current !== 'in_progress') ||
    (action !== 'dropoff' && current !== 'confirmed')
  )
    throw new ConflictException(
      'La reserva cambió de estado. Actualiza el viaje.',
    );
  return target;
}
export function trackingFreshness(
  position: LocationSample | null,
  now = Date.now(),
) {
  if (!position) return { state: 'unavailable', ageSeconds: null } as const;
  const ageSeconds = Math.max(
    0,
    Math.floor((now - Date.parse(position.capturedAt)) / 1000),
  );
  return {
    state: ageSeconds <= 10 ? 'live' : ageSeconds <= 30 ? 'delayed' : 'stale',
    ageSeconds,
  };
}
