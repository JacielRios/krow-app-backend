import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  nextBookingState,
  trackingFreshness,
  validateSample,
  type LocationSample,
} from './pilot.domain.js';
describe('pilot business and GPS boundaries', () => {
  const now = Date.parse('2026-10-06T18:00:00Z');
  const sample: LocationSample = {
    seq: 2,
    capturedAt: new Date(now).toISOString(),
    lat: 25.67,
    lng: -100.3,
    accuracy: 12,
  };
  it('boards explicitly, then drops off, with safe retries', () => {
    expect(nextBookingState('confirmed', 'board')).toBe('in_progress');
    expect(nextBookingState('in_progress', 'board')).toBe('in_progress');
    expect(nextBookingState('in_progress', 'dropoff')).toBe('completed');
    expect(nextBookingState('completed', 'dropoff')).toBe('completed');
    expect(() => nextBookingState('confirmed', 'dropoff')).toThrow(
      ConflictException,
    );
    expect(() => nextBookingState('completed', 'board')).toThrow(
      ConflictException,
    );
  });
  it('absence is allowed only before boarding and is idempotent', () => {
    expect(nextBookingState('confirmed', 'no-show')).toBe('no_show');
    expect(nextBookingState('no_show', 'no-show')).toBe('no_show');
    expect(() => nextBookingState('in_progress', 'no-show')).toThrow(
      ConflictException,
    );
  });
  it('acknowledges retransmission without overwriting newer position', () => {
    expect(validateSample(sample, 2, undefined, now)).toBe(false);
    expect(validateSample({ ...sample, seq: 1 }, 2, undefined, now)).toBe(
      false,
    );
    expect(
      validateSample(
        { ...sample, capturedAt: new Date(now - 1000).toISOString() },
        1,
        sample.capturedAt,
        now,
      ),
    ).toBe(false);
    expect(validateSample(sample, 1, undefined, now)).toBe(true);
  });
  it.each([
    { lat: 91 },
    { lng: 181 },
    { accuracy: 201 },
    { speed: -1 },
    { heading: 360 },
    { seq: 1.5 },
    { capturedAt: 'bad' },
    { capturedAt: new Date(now + 6000).toISOString() },
    { capturedAt: new Date(now - 600001).toISOString() },
  ])('rejects unsafe sample %j', (change) => {
    expect(() =>
      validateSample({ ...sample, ...change }, 1, undefined, now),
    ).toThrow(BadRequestException);
  });
  it('distinguishes live, delayed, stale and absent GPS', () => {
    expect(trackingFreshness(sample, now + 10000).state).toBe('live');
    expect(trackingFreshness(sample, now + 11000).state).toBe('delayed');
    expect(trackingFreshness(sample, now + 31000).state).toBe('stale');
    expect(trackingFreshness(null, now).state).toBe('unavailable');
  });
});
