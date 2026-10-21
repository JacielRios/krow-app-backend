import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Globals = {
  google?: unknown;
  krowGoogleMapsReady?: () => void;
  gm_authFailure?: () => void;
};
const globals = window as unknown as Globals;
describe('Google Maps browser loader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'synthetic-browser-key');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete globals.google;
    delete globals.krowGoogleMapsReady;
    delete globals.gm_authFailure;
    document.head
      .querySelectorAll('script[src*="maps.googleapis.com"]')
      .forEach((script) => script.remove());
  });
  it('rejects missing browser configuration without using any private server key', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'synthetic-private-server-key');
    const { loadGoogleMaps } = await import('./google-maps-browser');
    await expect(loadGoogleMaps()).rejects.toThrow('missing-browser-key');
    expect(
      document.head.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });
  it('shares one asynchronous SDK load and keeps the key in the official Google request', async () => {
    const { loadGoogleMaps } = await import('./google-maps-browser');
    const first = loadGoogleMaps();
    expect(loadGoogleMaps()).toBe(first);
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com"]',
    )!;
    const url = new URL(script.src);
    expect(url.hostname).toBe('maps.googleapis.com');
    expect(url.searchParams.get('language')).toBe('es');
    expect(url.searchParams.get('auth_referrer_policy')).toBe('origin');
    expect(script.async).toBe(true);
    globals.google = { maps: { Map: class {} } };
    globals.krowGoogleMapsReady!();
    await expect(first).resolves.toBe(
      (globals.google as { maps: unknown }).maps,
    );
    expect(
      document.head.querySelectorAll('script[src*="maps.googleapis.com"]'),
    ).toHaveLength(1);
  });
  it('cleans up failed requests and allows retry', async () => {
    const { loadGoogleMaps } = await import('./google-maps-browser');
    const first = loadGoogleMaps();
    const rejection = expect(first).rejects.toThrow('maps-network-failure');
    document.head.querySelector('script')!.dispatchEvent(new Event('error'));
    await rejection;
    const retry = loadGoogleMaps();
    const retryRejection = expect(retry).rejects.toThrow();
    globals.gm_authFailure!();
    await retryRejection;
    await expect(loadGoogleMaps()).rejects.toThrow('maps-auth-failure');
    expect(
      document.head.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });
  it('times out and removes an SDK request that never finishes', async () => {
    vi.useFakeTimers();
    const { loadGoogleMaps } = await import('./google-maps-browser');
    const result = loadGoogleMaps();
    const rejection = expect(result).rejects.toThrow('maps-timeout');
    await vi.advanceTimersByTimeAsync(20000);
    await rejection;
    expect(
      document.head.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });
});
