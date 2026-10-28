const ITEMS = [
  {
    icon: <img src="/img/salario.png" alt="" />,
    title: 'Comparte el costo',
    text: 'Consulta el precio por asiento antes de reservar y paga en efectivo al conductor.',
  },
  {
    icon: <img src="/img/proteger.png" alt="" />,
    title: 'Sigue tu trayecto',
    text: 'Perfil del conductor, calificaciones y seguimiento del vehículo durante el viaje.',
  },
  {
    icon: <img src="/img/auto-compartido.png" alt="" />,
    title: 'Comparte la ruta',
    text: 'Aprovecha los asientos disponibles en viajes que otros integrantes de tu comunidad ya realizarán.',
  },
  {
    icon: <img src="/img/tiempo-de-trabajo.png" alt="" />,
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

/*
<a href="https://www.flaticon.es/iconos-gratis/dinero" title="dinero iconos">Dinero iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/proteger" title="proteger iconos">Proteger iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/auto-compartido" title="auto compartido iconos">Auto compartido iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/trabajo" title="trabajo iconos">Trabajo iconos creados por Magnific - Flaticon</a>
*/