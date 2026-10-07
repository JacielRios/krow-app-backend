import type { ReactNode } from 'react';
import { AdminAuthProvider } from '@/lib/admin-auth';
import { AdminShell } from '@/components/admin/AdminShell';
import '@/components/admin/admin.css';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}
