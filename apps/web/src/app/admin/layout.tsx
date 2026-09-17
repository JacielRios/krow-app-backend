import Link from 'next/link';
import type { ReactNode } from 'react';

const links = [
  ['Dashboard', '/admin/dashboard'],
  ['Conductores', '/admin/conductores'],
  ['Vehículos', '/admin/vehiculos'],
  ['Documentos', '/admin/documentos'],
  ['Viajes', '/admin/viajes'],
  ['Auditoría', '/admin/auditoria'],
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/">KROW</Link>
        <nav className="admin-nav" aria-label="Administración">
          {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
