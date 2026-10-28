'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DriverAuthProvider, useDriverAuth } from '@/lib/driver-auth';
import '@/components/driver/driver.css';

const NAV = [
  { href: '/driver', label: 'Mi perfil' },
  { href: '/driver/dashboard', label: 'Dashboard' },
  { href: '/driver/viajes', label: 'Historial de viajes' },
  { href: '/driver/finanzas', label: 'Finanzas' },
];

function Shell({ children }: { children: ReactNode }) {
  const { email, signOut } = useDriverAuth();
  const pathname = usePathname();
  return (
    <div className="drv-shell">
      <aside className="drv-side">
        <div>
          <p className="drv-brand">KROW</p>
          <p className="drv-side-sub">Conductores</p>
        </div>
        <nav aria-label="Principal">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="drv-side-foot">
          {email && <p>{email}</p>}
          <button type="button" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
          <Link href="/">Ver sitio público ↗</Link>
        </div>
      </aside>
      <main className="drv-main">{children}</main>
    </div>
  );
}

export default function ConductorLayout({ children }: { children: ReactNode }) {
  return (
    <DriverAuthProvider>
      <Shell>{children}</Shell>
    </DriverAuthProvider>
  );
}
