import {
  assessSample,
  detectDeviation,
  distanceMeters,
  progressToStop,
  shouldReroute,
  transmissionInterval,
} from './geospatial.js';
import type { LocationSample, NavigationRoute } from './protocol.js';

describe('GPS quality and routing policy', () => {
  it('estimates each stop using its own leg duration instead of the final destination', () => {
    const route: NavigationRoute = {
      provider: 'mapbox',
      calculatedAt: '2026-09-28T12:00:00Z',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0.02, 0],
        ],
      },
      distanceMeters: 2000,
      durationSeconds: 600,
      stopIds: ['a', 'b'],
      trafficAvailable: false,
      legs: [
        { distanceMeters: 1000, durationSeconds: 100, steps: [] },
        { distanceMeters: 1000, durationSeconds: 500, steps: [] },
      ],
      stopProgress: [
        { stopId: 'a', distanceMeters: 1000, durationSeconds: 100 },
        { stopId: 'b', distanceMeters: 2000, durationSeconds: 600 },
      ],
    };
    expect(progressToStop({ lng: 0.005, lat: 0 }, route, 'a')).toMatchObject({
      remainingMeters: 500,
      etaSeconds: 50,
    });
    expect(progressToStop({ lng: 0.005, lat: 0 }, route, 'b')).toMatchObject({
      remainingMeters: 1500,
      etaSeconds: 550,
    });
    expect(progressToStop({ lng: 0.015, lat: 0 }, route, 'a')).toMatchObject({
      remainingMeters: 0,
      etaSeconds: 0,
    });
    expect(progressToStop({ lng: 0, lat: 0 }, route, 'missing')).toBeNull();
  });
  const now = Date.parse('2026-09-28T12:00:00Z');
  const fix: LocationSample = {
    sessionId: 'session',
    sequence: 10,
    capturedAt: new Date(now).toISOString(),
    lat: 19.4326,
    lng: -99.1332,
    accuracyMeters: 5,
    speedMps: 5,
    headingDegrees: 90,
  };
  it('rejects teleportation without rejecting normal motion', () => {
    const previous = {
      ...fix,
      sequence: 9,
      capturedAt: new Date(now - 2000).toISOString(),
    };
    expect(assessSample({ ...fix, lat: 20 }, previous, now)).toBe('reject');
    expect(assessSample({ ...fix, lat: 19.4327 }, previous, now)).toBe(
      'accept',
    );
  });
  it('keeps replayed and late points from replacing the live point', () => {
    expect(assessSample(fix, fix, now)).toBe('historical');
    expect(
      assessSample(
        { ...fix, capturedAt: new Date(now - 60000).toISOString() },
        null,
        now,
      ),
    ).toBe('historical');
    expect(
      assessSample(
        { ...fix, capturedAt: new Date(now + 60000).toISOString() },
        null,
        now,
      ),
    ).toBe('reject');
  });
  it('does not treat weak GPS as a confirmed deviation', () => {
    expect(
      detectDeviation(
        [0, 2500, 5000].map((at) => ({ at, distance: 70, accuracy: 5 })),
      ),
    ).toBe(true);
    expect(
      detectDeviation(
        [0, 2500, 5000].map((at) => ({ at, distance: 70, accuracy: 100 })),
      ),
    ).toBe(false);
  });
  it('prioritizes imminent stops and avoids marginal traffic reroutes', () => {
    expect(transmissionInterval(0, true)).toBe(1000);
    expect(transmissionInterval(0, false)).toBe(15000);
    expect(shouldReroute(1000, 890, 'traffic')).toBe(false);
    expect(shouldReroute(1000, 800, 'traffic')).toBe(true);
    expect(shouldReroute(1000, 1200, 'closure')).toBe(true);
    expect(distanceMeters(fix, fix)).toBe(0);
  });
});
