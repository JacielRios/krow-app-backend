'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { getAdminSupabase } from './admin-supabase';
import { apiBaseUrl, readableError } from './admin-utils';

export interface AdminIdentity {
  id: string;
  email?: string;
  role: 'admin';
  fullName?: string;
}
interface AuthContext {
  user: AdminIdentity | null;
  loading: boolean;
  error: string | null;
  getAccessToken: () => Promise<string>;
  signOut: () => Promise<void>;
  invalidate: (message: string) => void;
}
const Context = createContext<AuthContext | null>(null);

export async function verifyAdminSession(
  session: Session,
): Promise<AdminIdentity> {
  const response = await fetch(
    `${apiBaseUrl(process.env.NEXT_PUBLIC_API_URL)}/admin/me`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    },
  );
  if (response.status === 401)
    throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
  if (response.status === 403)
    throw new Error('Esta cuenta no tiene permisos administrativos.');
  if (!response.ok)
    throw new Error('No pudimos comprobar el acceso. Intenta nuevamente.');
  return response.json();
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback((message: string) => {
    generation.current += 1;
    setUser(null);
    setError(message);
    setLoading(false);
  }, []);
  const getAccessToken = useCallback(async () => {
    const { data, error: authError } =
      await getAdminSupabase().auth.getSession();
    if (authError || !data.session) {
      const message = 'Tu sesión expiró. Vuelve a iniciar sesión.';
      invalidate(message);
      throw new Error(message);
    }
    return data.session.access_token;
  }, [invalidate]);
  const signOut = useCallback(async () => {
    const { error: authError } = await getAdminSupabase().auth.signOut({
      scope: 'local',
    });
    if (authError)
      throw new Error('No pudimos cerrar la sesión. Intenta nuevamente.');
    invalidate('');
  }, [invalidate]);

  useEffect(() => {
    let mounted = true;
    const check = async (session: Session | null) => {
      const current = ++generation.current;
      if (!session) {
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const identity = await verifyAdminSession(session);
        if (mounted && current === generation.current) {
          setUser(identity);
          setError(null);
        }
      } catch (cause) {
        if (mounted && current === generation.current) {
          setUser(null);
          setError(readableError(cause));
        }
      } finally {
        if (mounted && current === generation.current) setLoading(false);
      }
    };
    try {
      const supabase = getAdminSupabase();
      void supabase.auth
        .getSession()
        .then(({ data, error: authError }) => {
          if (authError) throw authError;
          return check(data.session);
        })
        .catch((cause) => {
          if (mounted) {
            setError(readableError(cause));
            setLoading(false);
          }
        });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        // Supabase holds an auth lock in this callback; checking outside it avoids a deadlock.
        setTimeout(() => {
          if (mounted) void check(session);
        }, 0);
      });
      const onFocus = () => {
        void supabase.auth
          .getSession()
          .then(({ data }) => check(data.session))
          .catch((cause) => {
            if (mounted) invalidate(readableError(cause));
          });
      };
      window.addEventListener('focus', onFocus);
      return () => {
        mounted = false;
        generation.current += 1;
        subscription.unsubscribe();
        window.removeEventListener('focus', onFocus);
      };
    } catch (cause) {
      setError(readableError(cause));
      setLoading(false);
    }
    return () => {
      mounted = false;
      generation.current += 1;
    };
  }, [invalidate]);
  return (
    <Context.Provider
      value={{ user, loading, error, getAccessToken, signOut, invalidate }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('useAdminAuth requiere AdminAuthProvider.');
  return context;
}
