"use client";
import { useState } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import "./landing.css";
import "./pages.css";

type Status = "idle" | "sending" | "ok" | "error";

export default function ContactoPage() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const form = new FormData(e.currentTarget);
    try {
      // TODO: reemplazar por el endpoint real de apps/api cuando exista, p.ej.:
      // await client.request("/contact", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      await new Promise((r) => setTimeout(r, 600));
      setStatus("ok");
      e.currentTarget.reset();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <p className="eyebrow">Contacto</p>
        <h1>Hablemos</h1>
        <p>¿Tienes dudas, sugerencias o quieres reportar un problema? Escríbenos.</p>
      </section>

      <section className="content">
        <div className="content-grid">
          <form className="form-card" onSubmit={handleSubmit}>
            <h3>Envíanos un mensaje</h3>
            <div className="field">
              <label htmlFor="name">Nombre</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input id="email" name="email" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="topic">Asunto</label>
              <select id="topic" name="topic" defaultValue="general">
                <option value="general">Consulta general</option>
                <option value="soporte">Soporte / problema con un viaje</option>
                <option value="empresas">Interesado en KROW para empresas</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="message">Mensaje</label>
              <textarea id="message" name="message" required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={status === "sending"}>
              {status === "sending" ? "Enviando..." : "Enviar mensaje"}
            </button>
            {status === "ok" && <p className="form-status ok">Mensaje enviado. Te responderemos pronto.</p>}
            {status === "error" && <p className="form-status error">Hubo un problema al enviar. Intenta de nuevo.</p>}
          </form>

          <div className="contact-info">
            <div className="item">
              <div className="icon" aria-hidden="true">✉️</div>
              <div>
                <h4>Correo</h4>
                <a href="mailto:contacto@krow.app">contacto@krow.app</a>
              </div>
            </div>
            <div className="item">
              <div className="icon" aria-hidden="true"></div>
              <div>
                <h4>Ubicación</h4>
                <p>Monterrey, Nuevo León, México</p>
              </div>
            </div>
            <div className="item">
              <div className="icon" aria-hidden="true"> </div>
              <div>
                <h4>Soporte dentro de la app</h4>
                <p>Si ya eres usuario, también puedes escribirnos desde la sección de ayuda en la app.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
