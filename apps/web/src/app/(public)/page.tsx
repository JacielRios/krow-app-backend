import Link from 'next/link';

export default function LandingPage() {
  return (
    <>
      <header className="shell site-header">
        <Link className="brand" href="/">KROW</Link>
        <nav className="nav" aria-label="Navegación principal">
          <Link href="/empresas">Para empresas</Link>
          <Link href="/contacto">Contacto</Link>
          <Link className="button secondary" href="/admin/login">Acceso administrativo</Link>
        </nav>
      </header>

      <main>
        <section className="shell hero">
          <div>
            <p className="eyebrow">Movilidad que conecta</p>
            <h1>Traslados compartidos, seguros y mejor coordinados.</h1>
            <p className="lead">
              KROW conecta comunidades y empresas con conductores validados,
              rutas inteligentes e información operativa confiable.
            </p>
            <div className="actions">
              <Link className="button" href="/contacto">Hablar con KROW</Link>
              <Link className="button secondary" href="/empresas">Conocer la solución</Link>
            </div>
          </div>
          <aside className="card" aria-label="Capacidades de KROW">
            <div className="metric"><span>Conductores</span><strong>Validados</strong></div>
            <div className="metric"><span>Rutas</span><strong>Optimizadas</strong></div>
            <div className="metric"><span>Operación</span><strong>Visible</strong></div>
          </aside>
        </section>

        <section className="shell section">
          <p className="eyebrow">Una operación más clara</p>
          <h2>La movilidad también necesita control.</h2>
          <div className="grid">
            <article className="card"><h3>Seguridad</h3><p className="placeholder">Validación de conductores, vehículos y documentación.</p></article>
            <article className="card"><h3>Eficiencia</h3><p className="placeholder">Rutas compartidas y mejor aprovechamiento de cada viaje.</p></article>
            <article className="card"><h3>Información</h3><p className="placeholder">Indicadores operativos para tomar mejores decisiones.</p></article>
          </div>
        </section>
      </main>

      <footer className="shell site-footer">© {new Date().getFullYear()} KROW</footer>
    </>
  );
}
