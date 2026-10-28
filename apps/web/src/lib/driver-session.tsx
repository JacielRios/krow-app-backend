'use client';

export {
  DRIVER_LOGIN_PATH,
  DriverAuthProvider,
  useDriverAuth,
} from './driver-auth';
/*'use client';

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
import { readableError } from './admin-utils';
import { verifyDriverSession } from './driver-auth';

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
*/