import Link from 'next/link';

export function PublicSection({ title, description }: { title: string; description: string }) {
  return (
    <main className="shell section">
      <Link className="brand" href="/">KROW</Link>
      <section className="card" style={{ marginTop: 40 }}>
        <p className="eyebrow">KROW</p>
        <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 4.5rem)' }}>{title}</h1>
        <p className="lead">{description}</p>
        <div className="actions"><Link className="button secondary" href="/">Volver al inicio</Link></div>
      </section>
    </main>
  );
}
