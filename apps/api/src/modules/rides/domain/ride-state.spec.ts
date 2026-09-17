import { assertRideTransition } from './ride-state.js';

describe('ride state machine', () => {
  it('allows starting a scheduled ride', () => {
    expect(() =>
      assertRideTransition('scheduled', 'in_progress'),
    ).not.toThrow();
  });
  it('rejects reopening a completed ride', () => {
    expect(() => assertRideTransition('completed', 'scheduled')).toThrow();
  });
});
