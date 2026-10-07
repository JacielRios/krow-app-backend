import { approximateEta } from './pilot.eta.js';
describe('conservative pilot ETA', () => {
  const now = Date.now();
  const position = {
    seq: 1,
    capturedAt: new Date(now).toISOString(),
    lat: 38.5,
    lng: -120.2,
    accuracy: 10,
  };
  const route = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const destination = { lat: 43.252, lng: -126.453 };
  it('uses remaining route distance and provider duration', () => {
    expect(approximateEta(route, 300, position, destination, now)).toBe(300);
    expect(
      approximateEta(
        route,
        300,
        { ...position, ...destination },
        destination,
        now,
      ),
    ).toBe(0);
  });
  it('hides stale, inaccurate, off-route and malformed estimates', () => {
    expect(
      approximateEta(route, 300, position, destination, now + 11000),
    ).toBeNull();
    expect(
      approximateEta(
        route,
        300,
        { ...position, accuracy: 120 },
        destination,
        now,
      ),
    ).toBeNull();
    expect(
      approximateEta(route, 300, { ...position, lat: 1 }, destination, now),
    ).toBeNull();
    expect(approximateEta('bad', 300, position, destination, now)).toBeNull();
  });
});
