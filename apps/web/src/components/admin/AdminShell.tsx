'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useAdminAuth } from '@/lib/admin-auth';
import { readableError } from '@/lib/admin-utils';
const links = [
  ['Dashboard', '/admin/dashboard'],
  ['Conductores', '/admin/conductores'],
  ['Vehículos', '/admin/vehiculos'],
  ['Documentos', '/admin/documentos'],
  ['Viajes', '/admin/viajes'],
  ['Auditoría', '/admin/auditoria'],
];
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading, error, signOut } = useAdminAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  if (loading)
    return (
      <main className="admin-access">
        <p role="status">Verificando acceso administrativo…</p>
      </main>
    );
  if (!user)
    return (
      <main className="admin-access">
        <section className="card">
          <p className="eyebrow">KROW Administración</p>
          <h1>Acceso protegido</h1>
          <p role={error ? 'alert' : undefined}>
            {error || 'Inicia sesión con una cuenta autorizada para continuar.'}
          </p>
          <div className="actions">
            <Link className="button" href="/admin/login">
              Iniciar sesión
            </Link>
            {error && (
              <button
                className="button secondary"
                onClick={() => window.location.reload()}
              >
                Reintentar
              </button>
            )}
            <Link className="button secondary" href="/">
              Volver a KROW
            </Link>
          </div>
        </section>
      </main>
    );
  return (
    <div className="admin-shell admin-product">
      <a className="admin-skip" href="#admin-content">
        Ir al contenido
      </a>
      <header className="admin-mobile-header">
        <Link className="brand" href="/admin/dashboard">
          KROW
        </Link>
        <button
          className="button secondary"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="admin-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menú
        </button>
      </header>
      <aside
        className={`admin-sidebar${menuOpen ? ' is-open' : ''}`}
        id="admin-menu"
      >
        <Link className="brand" href="/admin/dashboard">
          KROW
        </Link>
        <p className="admin-caption">Administración</p>
        <nav className="admin-nav" aria-label="Administración">
          {links.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href || pathname.startsWith(`${href}/`)
                  ? 'page'
                  : undefined
              }
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="admin-session">
          <p>{user.email || user.fullName || 'Administrador'}</p>
          <button
            className="admin-logout"
            type="button"
            onClick={() => {
              void signOut().catch((cause) =>
                setLogoutError(readableError(cause)),
              );
            }}
          >
            Cerrar sesión
          </button>
          {logoutError && <p role="alert">{logoutError}</p>}
          <Link href="/">Ver sitio público ↗</Link>
        </div>
      </aside>
      <main className="admin-main" id="admin-content">
        {children}
      </main>
    </div>
  );
}
