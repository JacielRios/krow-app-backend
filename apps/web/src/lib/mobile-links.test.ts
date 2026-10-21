import { describe, expect, it } from 'vitest';
import { androidIntentForLink, MOBILE_LINK_ORIGIN } from './mobile-links';

const id = '11111111-1111-4111-8111-111111111111';
describe('Android app-link fallback', () => {
  it('preserves only one invitation marker and never mixes it with a booking destination', () => {
    expect(
      androidIntentForLink(`${MOBILE_LINK_ORIGIN}/rides/${id}?invite=1`),
    ).toContain('?invite=1#Intent');
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/rides/${id}?invite=1&invite=1`,
      ),
    ).not.toContain('?invite');
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/rides/${id}?invite=1&bookingId=${id}`,
      ),
    ).toContain(`?bookingId=${id}#Intent`);
  });
  it('preserves exactly one valid booking identifier for the Android inbox', () => {
    expect(
      androidIntentForLink(`${MOBILE_LINK_ORIGIN}/rides/${id}?bookingId=${id}`),
    ).toContain(`?bookingId=${id}#Intent`);
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/rides/${id}?bookingId=${id}&bookingId=${id}`,
      ),
    ).not.toContain('?bookingId');
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/rides/${id}?bookingId=bad;package=other`,
      ),
    ).not.toContain('package=other');
  });
  it('opens only the existing package and drops unrelated trip query parameters', () => {
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/rides/${id}?redirect=https://other.test`,
      ),
    ).toBe(
      `intent://krow-web-gamma.vercel.app/rides/${id}#Intent;scheme=https;package=com.krownmobileapp;end`,
    );
  });
  it('preserves a PKCE code or valid token hash without allowing Intent injection', () => {
    const url = new URL('/auth/callback', MOBILE_LINK_ORIGIN);
    url.searchParams.set('code', 'code;package=other;end#fragment');
    const intent = androidIntentForLink(url.href)!;
    expect(intent).toContain('code=code%3Bpackage%3Dother%3Bend%23fragment');
    expect(intent.match(/#Intent/g)).toHaveLength(1);
    expect(intent).toContain('package=com.krownmobileapp');
    expect(
      androidIntentForLink(
        `${MOBILE_LINK_ORIGIN}/auth/callback?token_hash=test&type=recovery`,
      ),
    ).toContain('token_hash=test&type=recovery#Intent');
  });
  it.each([
    'https://other.test/rides/' + id,
    'http://krow-web-gamma.vercel.app/rides/' + id,
    'https://user@krow-web-gamma.vercel.app/rides/' + id,
    MOBILE_LINK_ORIGIN + '/rides/invalid',
    MOBILE_LINK_ORIGIN + '/admin',
    MOBILE_LINK_ORIGIN + '/auth/callback?code=a&code=b',
    MOBILE_LINK_ORIGIN + '/auth/callback?code=a&token_hash=b&type=recovery',
    MOBILE_LINK_ORIGIN + '/auth/callback?token_hash=a&type=unknown',
    MOBILE_LINK_ORIGIN + '/auth/callback',
    'invalid',
  ])('rejects an unapproved or ambiguous link: %s', (url) => {
    expect(androidIntentForLink(url)).toBeNull();
  });
});
