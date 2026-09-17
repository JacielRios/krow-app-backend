export default function DashboardPage() {
  const metrics = ['Viajes realizados', 'Conductores activos', 'Ocupación promedio'];
  return (
    <>
      <header className="admin-header"><div><p className="eyebrow">Operación</p><h2>Dashboard</h2></div></header>
      <section className="admin-grid">
        {metrics.map((metric) => <article className="card" key={metric}><p className="placeholder">{metric}</p><h2>—</h2></article>)}
      </section>
    </>
  );
}
