import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'KROW | Movilidad compartida',
    template: '%s | KROW',
  },
  description:
    'Plataforma de movilidad compartida para comunidades y empresas.',
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
