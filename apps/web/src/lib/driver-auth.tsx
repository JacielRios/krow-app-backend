'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { getAdminSupabase } from './admin-supabase';
import { apiBaseUrl, readableError } from './admin-utils';

type SessionLike = { access_token: string };

/**
 * Pregunta al backend si la cuenta tiene un perfil de conductor habilitado.
 * La decisión la toma la API (GET /v1/drivers/me), nunca el navegador.
 */
export async function verifyDriverSession(
  session: SessionLike,
): Promise<{ driver_id: string }> {
  const base = apiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
  let response: Response;
  try {
    response = await fetch(`${base}/drivers/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('No pudimos conectar con el servidor. Intenta de nuevo.');
  }

  if ([401, 403, 404].includes(response.status))
    throw new Error('Esta cuenta no es de un conductor registrado y activo.');
  if (!response.ok)
    throw new Error('No pudimos verificar tu cuenta. Intenta de nuevo.');

  return (await response.json()) as { driver_id: string };
}

/* ---------- Sesión del conductor ---------- */

// ⚠️ Ajusta esta constante a la URL real de tu pantalla de login.
export const DRIVER_LOGIN_PATH = '/admin/login';

type DriverAuthValue = {
  email: string | null;
  getAccessToken: () => Promise<string>;
  invalidate: () => void;
  signOut: () => Promise<void>;
};

const DriverAuthContext = createContext<DriverAuthValue | null>(null);

export function useDriverAuth() {
  const value = useContext(DriverAuthContext);
  if (!value)
    throw new Error('useDriverAuth debe usarse dentro de DriverAuthProvider.');
  return value;
}

/**
 * Protege el panel del conductor: exige una sesión de Supabase y que el
 * backend confirme el perfil de conductor. Mientras tanto no muestra nada.
 */
export function DriverAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    try {
      await getAdminSupabase().auth.signOut({ scope: 'local' });
    } catch {
      // Aun si falla el cierre remoto, salimos de la pantalla protegida.
    }
    router.replace(DRIVER_LOGIN_PATH);
  }, [router]);

  const getAccessToken = useCallback(async () => {
    const { data } = await getAdminSupabase().auth.getSession();
    if (!data.session)
      throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return data.session.access_token;
  }, []);

  const invalidate = useCallback(() => {
    void signOut();
  }, [signOut]);

  useEffect(() => {
    let active = true;
    const supabase = getAdminSupabase();
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace(DRIVER_LOGIN_PATH);
          return;
        }
        await verifyDriverSession(data.session);
        if (!active) return;
        setEmail(data.session.user?.email ?? null);
        setReady(true);
      } catch (cause) {
        if (!active) return;
        setFailure(readableError(cause));
        await signOut();
      }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace(DRIVER_LOGIN_PATH);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router, signOut]);

  const value = useMemo(
    () => ({ email, getAccessToken, invalidate, signOut }),
    [email, getAccessToken, invalidate, signOut],
  );

  if (!ready)
    return (
      <p role="status" className="drv-session">
        {failure ?? 'Verificando tu sesión…'}
      </p>
    );
  return (
    <DriverAuthContext.Provider value={value}>
      {children}
    </DriverAuthContext.Provider>
  );
}

/* ---------- Llamadas a la API ---------- */

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

export function useDriverApi() {
  const { getAccessToken, invalidate } = useDriverAuth();
  return useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      const token = await getAccessToken();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (options.signal?.aborted) cancel();
      else options.signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(
          `${apiBaseUrl(process.env.NEXT_PUBLIC_API_URL)}${path}`,
          {
            method: options.method ?? 'GET',
            signal: controller.signal,
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${token}`,
              ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          },
        );
        if (response.status === 401 || response.status === 403) {
          const message =
            response.status === 401
              ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
              : 'Tu cuenta ya no tiene permiso para esta acción.';
          invalidate();
          throw new Error(message);
        }
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          const message = result?.message;
          throw new Error(
            typeof message === 'string'
              ? message
              : Array.isArray(message)
                ? message.join('. ')
                : 'No se pudo completar la acción. Intenta nuevamente.',
          );
        }
        return response.status === 204
          ? (undefined as T)
          : await response.json();
      } catch (error) {
        if (controller.signal.aborted && !options.signal?.aborted)
          throw new Error(
            'KROW tardó demasiado en responder. Revisa tu conexión e intenta de nuevo.',
          );
        throw error;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', cancel);
      }
    },
    [getAccessToken, invalidate],
  );
}

export interface DriverPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function useDriverResource<T>(path: string) {
  const request = useDriverApi();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void request<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(readableError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, path, revision]);
  return { data, loading, error, reload };
}
