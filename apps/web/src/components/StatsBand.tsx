const STATS = [
  { num: "12,000+", label: "Viajes compartidos" },
  { num: "3,200+", label: "Usuarios activos" },
  { num: "8", label: "Ciudades" },
  { num: "4.8/5", label: "Calificación promedio" },
];

export function StatsBand() {
  return (
    <section className="stats">
      <div className="stats-grid">
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="num">{s.num}</p>
            <p className="label">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
