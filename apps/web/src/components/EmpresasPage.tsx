'use client';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import './landing.css';
import './pages.css';

const USE_CASES = [
  {
    title: 'Traslados compartidos',
    text: 'Explorar rutas entre personas con horarios y destinos compatibles.',
  },
  {
    title: 'Uso de los asientos',
    text: 'Aprovechar capacidad disponible en trayectos que ya se realizan.',
  },
  {
    title: 'Participación del equipo',
    text: 'Evaluar necesidades de transporte antes de definir una ampliación.',
  },
  {
    title: 'Seguimiento de actividad',
    text: 'Valorar qué reportes necesita la organización, sin prometer métricas de ahorro o emisiones no medidas.',
  },
];

export default function EmpresasPage() {
  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <p className="eyebrow">Para Empresas</p>
        <h1>Exploremos los viajes compartidos en tu organización</h1>
        <p>
          KROW está probando su experiencia con la comunidad del Instituto
          Tecnológico de Nuevo León. La oferta para empresas es una posible
          ampliación posterior al piloto.
        </p>
      </section>

      <section className="values">
        <div className="section-head">
          <p className="eyebrow">Posibilidades a explorar</p>
          <h2>Diseñar una solución a partir de necesidades reales</h2>
        </div>
        <div className="use-cases">
          {USE_CASES.map((u) => (
            <article key={u.title} className="use-case">
              <h3>{u.title}</h3>
              <p>{u.text}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="cta-banner">
        <h2>¿Quieres llevar KROW a tu empresa?</h2>
        <p>
          Consulta el canal del equipo para conversar sobre una futura
          ampliación.
        </p>
        <a href="/contacto" className="btn btn-primary">
          Hablar con nosotros
        </a>
      </div>

      <Footer />
    </div>
  );
}
