import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ intent: vi.fn() }));
vi.mock('../lib/mobile-links', () => ({
  androidIntentForLink: mocks.intent,
  MOBILE_LINK_ORIGIN: 'https://krow-web-gamma.vercel.app',
}));
import { MobileLinkLanding } from './MobileLinkLanding';

beforeEach(() => vi.clearAllMocks());
it('offers a deliberate app open without exposing trip details in the browser', () => {
  mocks.intent.mockReturnValue(
    'intent://example#Intent;scheme=https;package=com.krownmobileapp;end',
  );
  render(<MobileLinkLanding kind="trip" />);
  expect(
    screen.getByRole('link', { name: 'Abrir KROW en Android' }),
  ).toHaveAttribute('href', expect.stringContaining('intent://'));
  expect(screen.getByText(/cuenta que tenga acceso/)).toBeInTheDocument();
});
it('does not create or consume a browser session for a missing auth code', () => {
  mocks.intent.mockReturnValue(null);
  render(<MobileLinkLanding kind="auth" />);
  expect(screen.getByRole('status')).toHaveTextContent('solicita uno nuevo');
  expect(
    screen.queryByRole('link', { name: 'Abrir KROW en Android' }),
  ).toBeNull();
});
