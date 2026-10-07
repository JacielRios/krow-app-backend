"use client";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import "./landing.css";
import "./pages.css";

const USE_CASES = [
  { title: "Traslado de personal", text: "Organiza rutas compartidas entre empleados que viven cerca y trabajan en el mismo turno." },
  { title: "Reduce tu huella corporativa", text: "Menos autos individuales llegando a tus instalaciones significa menos emisiones que reportar." },
  { title: "Beneficio para tu equipo", text: "Ofrece KROW como prestación: tus colaboradores ahorran en transporte sin que tú operes flotillas." },
  { title: "Reportes de uso", text: "Visibilidad de viajes realizados, ahorro estimado y participación por área o turno." },
];

export default function EmpresasPage() {
  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <p className="eyebrow">Para Empresas</p>
        <h1>Lleva el carpooling a tu organización</h1>
        <p>
          Ayuda a tu equipo a llegar al trabajo gastando menos, mientras reduces el impacto
          ambiental y la congestión alrededor de tus instalaciones.
        </p>
      </section>

      <section className="values">
        <div className="section-head">
          <p className="eyebrow">Qué obtienes</p>
          <h2>Pensado para equipos de cualquier tamaño</h2>
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
        <p>Cuéntanos sobre tu equipo y te contactamos para armar un plan a tu medida.</p>
        <a href="/contacto" className="btn btn-primary">Hablar con nosotros</a>
      </div>

      <Footer />
    </div>
  );
}
