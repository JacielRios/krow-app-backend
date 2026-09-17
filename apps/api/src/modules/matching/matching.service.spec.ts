import { MatchingService } from './matching.service.js';

describe('MatchingService', () => {
  const matching = new MatchingService();
  it('gives an exact route the maximum score', () => {
    const origin = { lat: 19.4326, lng: -99.1332 };
    const destination = { lat: 19.4978, lng: -99.1269 };
    expect(matching.score(origin, destination, origin, destination).score).toBe(
      100,
    );
  });
  it('penalizes a route that starts farther away', () => {
    const result = matching.score(
      { lat: 19.4326, lng: -99.1332 },
      undefined,
      { lat: 19.5, lng: -99.2 },
      { lat: 19.6, lng: -99.3 },
    );
    expect(result.originDistanceKm).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });
});
