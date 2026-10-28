import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyDriverSession } from './driver-auth';

const fetchMock = vi.fn();

describe('verifyDriverSession', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3000');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('consulta /v1/drivers/me con el token de la sesión', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ driver_id: 'd1' }), { status: 200 }),
    );
    await expect(verifyDriverSession({ access_token: 'tok' })).resolves.toEqual(
      { driver_id: 'd1' },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/v1/drivers/me');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it.each([401, 403, 404])(
    'rechaza con mensaje claro cuando la API responde %i',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(null, { status }));
      await expect(
        verifyDriverSession({ access_token: 'tok' }),
      ).rejects.toThrow(/conductor registrado y activo/);
    },
  );

  it('distingue una falla del servidor de una cuenta no habilitada', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(verifyDriverSession({ access_token: 'tok' })).rejects.toThrow(
      /No pudimos verificar/,
    );
  });

  it('avisa cuando no hay conexión', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(verifyDriverSession({ access_token: 'tok' })).rejects.toThrow(
      /No pudimos conectar/,
    );
  });
});
