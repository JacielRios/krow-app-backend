'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { androidIntentForLink, MOBILE_LINK_ORIGIN } from '../lib/mobile-links';

export function MobileLinkLanding({ kind }: { kind: 'trip' | 'auth' }) {
  const [intent, setIntent] = useState<string | null>(null);
  useEffect(() => {
    const target = new URL(
      window.location.pathname + window.location.search,
      MOBILE_LINK_ORIGIN,
    );
    setIntent(androidIntentForLink(target.href));
  }, []);
  return (
    <main className="shell section" style={{ maxWidth: 680 }}>
      <span className="brand">KROW</span>
      <section className="card" style={{ marginTop: 24 }}>
        <h1 style={{ fontSize: '2.4rem', lineHeight: 1.15 }}>
          {kind === 'trip'
            ? 'Abre tu viaje en KROW'
            : 'Continúa el acceso en KROW'}
        </h1>
        <p className="lead">
          {kind === 'trip'
            ? 'Consulta la información actual del viaje en la aplicación Android. Necesitas iniciar sesión con una cuenta que tenga acceso.'
            : 'Abre este enlace en el mismo Android donde solicitaste el acceso o la recuperación de contraseña.'}
        </p>
        {intent ? (
          <a className="button" href={intent} rel="noreferrer">
            Abrir KROW en Android
          </a>
        ) : (
          <p role="status">
            {kind === 'auth'
              ? 'Si el enlace ya no está disponible, solicita uno nuevo desde KROW.'
              : 'Comprueba el enlace que recibiste.'}
          </p>
        )}
        <p className="lead" style={{ fontSize: '1rem' }}>
          Si no tienes la aplicación instalada, solicita al equipo de KROW la
          versión de prueba vigente.
        </p>
        <Link href="/" className="button secondary">
          Volver al sitio de KROW
        </Link>
      </section>
    </main>
  );
}
