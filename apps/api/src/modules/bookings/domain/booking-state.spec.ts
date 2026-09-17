import { assertBookingTransition } from './booking-state.js';

describe('booking state machine', () => {
  it('allows confirming a pending booking', () => {
    expect(() => assertBookingTransition('pending', 'confirmed')).not.toThrow();
  });
  it('rejects changing a cancelled booking', () => {
    expect(() => assertBookingTransition('cancelled', 'confirmed')).toThrow();
  });
});
