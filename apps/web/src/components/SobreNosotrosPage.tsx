'use client';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import './landing.css';
import './pages.css';

const VALUES = [
  {
    icon: <img src="/img/socios.png" alt="" />,
    title: 'Comunidad',
    text: 'Creemos en moverse juntos, no solo en llegar rápido.',
  },
  {
    icon: <img src="/img/auto-confianza.png" alt="" />,
    title: 'Confianza',
    text: 'Información clara para coordinar cada viaje compartido.',
  },
  {
    icon: <img src="/img/brote.png" alt="" />,
    title: 'Responsabilidad',
    text: 'Aprovechar los asientos disponibles en trayectos de nuestra comunidad.',
  },
];

export default function SobreNosotrosPage() {
  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <p className="eyebrow">Sobre Nosotros</p>
        <h1>Movemos personas, no solo autos</h1>
        <p>
          KROW nació para resolver un problema simple: miles de autos recorren
          todos los días las mismas rutas con un solo pasajero adentro. Creemos
          que compartir el trayecto es mejor para tu bolsillo, tu tiempo y tu
          ciudad.
        </p>
      </section>

      <section className="content">
        <div className="legal" style={{ padding: 0 }}>
          <h2>¿Quiénes somos?</h2>
          <p>
            KROW es una app móvil de viajes compartidos que conecta a
            estudiantes dentro de su institución para organizar sus trayectos
            desde el Instituto Tecnológico de Nuevo León. Optimizamos los
            traslados diarios. Más que una app, buscamos construir una comunidad
            que comparta el camino.
          </p>
          <h2>Nuestra Misión</h2>
          <p>
            Transformar la movilidad dentro de comunidades universitarias
            mediante una plataforma digital segura, eficiente y colaborativa que
            conecta a conductores y pasajeros optimizando tiempos, reduciendo
            costos y mejorando la experiencia de traslado diario.
          </p>
          <h2>Nuestra Visión</h2>
          <p>
            Ser la plataforma líder de movilidad inteligente en instituciones
            educativas, reconocida por innovar en el transporte colaborativo y
            construir comunidades más conectadas, seguras y sostenibles
          </p>

          <h2>Cómo empezamos</h2>
          <p>
            El proyecto arrancó como una respuesta al tráfico y al costo
            creciente de transportarse día a día. Hoy seguimos construyendo la
            plataforma junto con nuestra comunidad de conductores y pasajeros.
          </p>
        </div>

        <div className="values-row">
          {VALUES.map((v) => (
            <div className="v" key={v.title}>
              <div className="icon" aria-hidden="true">
                {v.icon}
              </div>
              <h3 style={{ fontSize: 16 }}>{v.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="cta-banner">
        <h2>¿Quieres ser parte de KROW?</h2>
        <p>
          Únete como pasajero o conductor y empieza a compartir tus trayectos.
        </p>
        <a href="/#como-funciona" className="btn btn-primary">
          Conocer el piloto
        </a>
      </div>

      <Footer />
    </div>
  );
}

/*<a href="https://www.flaticon.es/iconos-gratis/colaboracion" title="colaboración iconos">Colaboración iconos creados por small.smiles - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/confianza" title="confianza iconos">Confianza iconos creados por Magnific - Flaticon</a>
<a href="https://www.flaticon.es/iconos-gratis/responsabilidad" title="responsabilidad iconos">Responsabilidad iconos creados por surang - Flaticon</a>
*/
