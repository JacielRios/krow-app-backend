/** Only a website-restricted browser key belongs here; never use the API server key. */
export const GOOGLE_MAPS_AUTH_FAILURE = 'krow:google-maps-auth-failure';
let pending: Promise<typeof google.maps> | null = null;
let authenticationFailed = false;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return Promise.reject(new Error('missing-browser-key'));
  if (authenticationFailed)
    return Promise.reject(new Error('maps-auth-failure'));
  if (pending) return pending;
  const globals = window as typeof window & {
    google?: typeof google;
    krowGoogleMapsReady?: () => void;
    gm_authFailure?: () => void;
  };
  if (globals.google?.maps?.Map) return Promise.resolve(globals.google.maps);
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      delete globals.krowGoogleMapsReady;
      script.onerror = null;
      if (error) {
        script.remove();
        pending = null;
        reject(error);
      } else if (globals.google?.maps) resolve(globals.google.maps);
      else {
        pending = null;
        reject(new Error('maps-unavailable'));
      }
    };
    const timeout = window.setTimeout(
      () => finish(new Error('maps-timeout')),
      20000,
    );
    globals.krowGoogleMapsReady = () => finish();
    globals.gm_authFailure = () => {
      authenticationFailed = true;
      window.dispatchEvent(new Event(GOOGLE_MAPS_AUTH_FAILURE));
      finish(new Error('maps-auth-failure'));
    };
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams(
      {
        key,
        v: 'quarterly',
        loading: 'async',
        callback: 'krowGoogleMapsReady',
        language: 'es',
        region: 'MX',
        auth_referrer_policy: 'origin',
      },
    )}`;
    script.onerror = () => finish(new Error('maps-network-failure'));
    document.head.appendChild(script);
  });
  return pending;
}
