'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getAdminSupabase } from '@/lib/admin-supabase';
import { verifyAdminSession } from '@/lib/admin-auth';
import { verifyDriverSession } from '@/lib/driver-auth';
import { readableError } from '@/lib/admin-utils';
import './login.css';

type Role = 'admin' | 'driver';

const ROLES: Record<
  Role,
  {
    tab: string;
    eyebrow: string;
    description: string;
    note: string;
    redirect: string;
  }
> = {
  admin: {
    tab: 'Administrador',
    eyebrow: 'Administración',
    description: 'Usa tu cuenta autorizada para gestionar la operación.',
    note: 'El acceso lo habilita el equipo de KROW. Las cuentas de pasajeros y conductores no reciben permisos administrativos.',
    redirect: '/admin/dashboard',
  },
  driver: {
    tab: 'Conductor',
    eyebrow: 'Conductores',
    description: 'Inicia sesión para ver tus viajes, ganancias y pagos.',
    note: 'Solo pueden entrar los conductores registrados y activos en KROW.',
    redirect: '/driver',
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = ROLES[role];

  function selectRole(next: Role) {
    if (busy || next === role) return;
    setRole(next);
    setError(null);
    setPassword('');
    setShowPassword(false);
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Administrador y conductor son la misma cuenta de Supabase Auth:
      // el rol se comprueba en el backend, no con otro cliente.
      const supabase = getAdminSupabase();
      const { data, error: authError } = await supabase.auth.signInWithPassword(
        { email: email.trim(), password },
      );
      if (authError || !data.session)
        throw new Error(
          'No pudimos iniciar sesión. Revisa tu correo y contraseña.',
        );
      try {
        if (role === 'admin') await verifyAdminSession(data.session);
        else await verifyDriverSession(data.session);
      } catch (cause) {
        await supabase.auth.signOut({ scope: 'local' });
        throw cause;
      }
      setPassword('');
      router.replace(copy.redirect);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="login-brand" href="/">
          KROW
        </Link>

        <div className="login-tabs" role="tablist" aria-label="Tipo de cuenta">
          {(Object.keys(ROLES) as Role[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="login-tab"
              aria-selected={role === key}
              onClick={() => selectRole(key)}
            >
              {ROLES[key].tab}
            </button>
          ))}
        </div>

        <p className="login-eyebrow">{copy.eyebrow}</p>
        <h1 className="login-title">Bienvenido de nuevo</h1>
        <p className="login-description">{copy.description}</p>

        <form
          onSubmit={(event) => {
            void login(event);
          }}
          aria-busy={busy}
        >
          <div className="login-field">
            <label htmlFor="login-email">Correo</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="login-link"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            </button>
          </div>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button className="login-button" type="submit" disabled={busy}>
            {busy ? 'Verificando acceso…' : 'Entrar'}
          </button>
        </form>

        <p className="login-description login-small">{copy.note}</p>
        <Link className="login-link" href="/">
          Volver al sitio
        </Link>
      </section>
    </main>
  );
}
