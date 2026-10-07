const ITEMS = [
  { icon: <img src="/img/ahorro-de-dinero.png"></img>, title: "Ahorra en cada viaje", text: "Divide el costo de la gasolina y el peaje con quienes van hacia tu misma ruta." },
  { icon: <img src="/img/proteger.png"></img>, title: "Viaja con seguridad", text: "Conductores verificados, calificaciones y seguimiento del viaje en tiempo real." },
  { icon: <img src="/img/el-planeta-tierra.png"></img>, title: "Reduce tu huella", text: "Menos autos en la calle significa menos tráfico y menos emisiones por persona." },
  { icon: <img src="/img/gestion-del-tiempo.png"></img>, title: "Ahorra tiempo", text: "Encuentra viajes compatibles con tu horario en segundos, sin complicaciones." },
];

export function ValueProps() {
  return (
    <section className="values" id="beneficios">
      <div className="section-head">
        <p className="eyebrow">Por qué KROW</p>
        <h2>Una forma más inteligente de moverte</h2>
      </div>
      <div className="value-grid">
        {ITEMS.map((it) => (
          <article key={it.title} className="value-card">
            <div className="icon" aria-hidden="true">{it.icon}</div>
            <h3>{it.title}</h3>
            <p>{it.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/*<a href="https://www.flaticon.es/iconos-gratis/ahorrar-dinero" title="ahorrar dinero iconos">Ahorrar dinero iconos creados por Eucalyp - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/seguridad" title="seguridad iconos">Seguridad iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/sustentabilidad" title="sustentabilidad iconos">Sustentabilidad iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/gestion-del-tiempo" title="gestión del tiempo iconos">Gestión del tiempo iconos creados por Kalashnyk - Flaticon</a>
*/