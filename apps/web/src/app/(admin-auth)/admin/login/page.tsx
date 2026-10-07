'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getAdminSupabase } from '@/lib/admin-supabase';
import { verifyAdminSession } from '@/lib/admin-auth';
import { readableError } from '@/lib/admin-utils';
import '@/components/admin/admin.css';
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getAdminSupabase();
      const { data, error: authError } = await supabase.auth.signInWithPassword(
        { email: email.trim(), password },
      );
      if (authError || !data.session)
        throw new Error(
          'No pudimos iniciar sesión. Revisa tu correo y contraseña.',
        );
      try {
        await verifyAdminSession(data.session);
      } catch (cause) {
        await supabase.auth.signOut({ scope: 'local' });
        throw cause;
      }
      setPassword('');
      router.replace('/admin/dashboard');
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page admin-product">
      <section className="card login-card">
        <Link className="brand" href="/">
          KROW
        </Link>
        <p className="eyebrow">Administración</p>
        <h1>Bienvenido de nuevo</h1>
        <p className="admin-description">
          Usa tu cuenta autorizada para gestionar la operación.
        </p>
        <form
          onSubmit={(event) => {
            void login(event);
          }}
          aria-busy={busy}
        >
          <div className="field">
            <label htmlFor="admin-email">Correo</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="admin-password">Contraseña</label>
            <input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="admin-text-button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            </button>
          </div>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <button className="button admin-wide" type="submit" disabled={busy}>
            {busy ? 'Verificando acceso…' : 'Entrar'}
          </button>
        </form>
        <p className="admin-description admin-small">
          El acceso lo habilita el equipo de KROW. Las cuentas de pasajeros y
          conductores no reciben permisos administrativos.
        </p>
        <Link className="admin-text-button" href="/">
          Volver al sitio
        </Link>
      </section>
    </main>
  );
}
