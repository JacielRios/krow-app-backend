const PILOT = [
  { num: 'ITNL', label: 'Punto de salida de los viajes' },
  { num: 'Android', label: 'Plataforma del piloto' },
  { num: 'Efectivo', label: 'Forma de pago actual' },
  { num: 'GPS online', label: 'Seguimiento durante el viaje' },
];

export function StatsBand() {
  return (
    <section className="stats" aria-label="Alcance actual del piloto">
      <div className="stats-grid">
        {PILOT.map((item) => (
          <div key={item.label}>
            <p className="num">{item.num}</p>
            <p className="label">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
