import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ getToken: vi.fn(), invalidate: vi.fn() }));
vi.mock('./admin-auth', () => ({
  useAdminAuth: () => ({
    getAccessToken: mocks.getToken,
    invalidate: mocks.invalidate,
  }),
}));
import { useAdminApi, useAdminResource } from './admin-api';
describe('administrative requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example/v1');
    mocks.getToken.mockResolvedValue('test-access');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('sends authorization to the backend and leaves no duplicate API prefix', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useAdminApi());
    await result.current('/admin/drivers');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example/v1/admin/drivers',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: 'Bearer test-access' },
      }),
    );
  });
  it('immediately invalidates revoked administrator authority', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    const { result } = renderHook(() => useAdminApi());
    await expect(result.current('/admin/drivers')).rejects.toThrow(
      'ya no tiene permiso',
    );
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it('does not replace new filters with late responses from the previous request', async () => {
    let finishFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      finishFirst = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        url.includes('page=1')
          ? first
          : Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ items: ['new-page'] }),
            }),
      );
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ path }) => useAdminResource<{ items: string[] }>(path),
      { initialProps: { path: '/admin/drivers?page=1' } },
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    rerender({ path: '/admin/drivers?page=2' });
    await waitFor(() =>
      expect(result.current.data).toEqual({ items: ['new-page'] }),
    );
    await act(async () =>
      finishFirst({
        ok: true,
        status: 200,
        json: async () => ({ items: ['stale-page'] }),
      }),
    );
    expect(result.current.data).toEqual({ items: ['new-page'] });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
