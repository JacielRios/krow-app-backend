const ITEMS = [
  {
    icon: <img src="/img/ahorro-de-dinero.png" alt="" />,
    title: 'Comparte el costo',
    text: 'Consulta el precio por asiento antes de reservar y paga en efectivo al conductor.',
  },
  {
    icon: <img src="/img/proteger.png" alt="" />,
    title: 'Sigue tu trayecto',
    text: 'Perfil del conductor, calificaciones y seguimiento del vehículo durante el viaje.',
  },
  {
    icon: <img src="/img/el-planeta-tierra.png" alt="" />,
    title: 'Comparte la ruta',
    text: 'Aprovecha los asientos disponibles en viajes que otros integrantes de tu comunidad ya realizarán.',
  },
  {
    icon: <img src="/img/gestion-del-tiempo.png" alt="" />,
    title: 'Organiza tu salida',
    text: 'Consulta horarios y paradas de los viajes que salen del Instituto Tecnológico de Nuevo León.',
  },
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
            <div className="icon" aria-hidden="true">
              {it.icon}
            </div>
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
