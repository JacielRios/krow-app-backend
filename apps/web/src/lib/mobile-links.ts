export const MOBILE_LINK_ORIGIN = 'https://krow-web-gamma.vercel.app';
export const ANDROID_PACKAGE = 'com.krownmobileapp';
export const TRIP_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The browser fallback opens only this Android package and an approved path.
// Re-encode query values so they cannot inject Android Intent directives.
export function androidIntentForLink(input: string): string | null {
  try {
    const source = new URL(input);
    if (
      source.origin !== MOBILE_LINK_ORIGIN ||
      source.username ||
      source.password
    )
      return null;
    const target = new URL(source.pathname, MOBILE_LINK_ORIGIN);
    if (target.pathname === '/auth/callback') {
      const code = source.searchParams.getAll('code');
      const hash = source.searchParams.getAll('token_hash');
      const type = source.searchParams.getAll('type');
      if (code.length === 1 && code[0] && hash.length === 0)
        target.searchParams.set('code', code[0]);
      else if (
        hash.length === 1 &&
        hash[0] &&
        code.length === 0 &&
        type.length === 1 &&
        ['signup', 'recovery'].includes(type[0])
      ) {
        target.searchParams.set('token_hash', hash[0]);
        target.searchParams.set('type', type[0]);
      } else return null;
    } else {
      const id = /^\/rides\/([^/]+)\/?$/.exec(target.pathname)?.[1];
      if (!id || !TRIP_ID.test(id)) return null;
      const booking = source.searchParams.getAll('bookingId');
      if (booking.length === 1 && TRIP_ID.test(booking[0]))
        target.searchParams.set('bookingId', booking[0]);
      else if (
        !booking.length &&
        source.searchParams.getAll('invite').length === 1 &&
        source.searchParams.get('invite') === '1'
      )
        target.searchParams.set('invite', '1');
    }
    return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=https;package=${ANDROID_PACKAGE};end`;
  } catch {
    return null;
  }
}
