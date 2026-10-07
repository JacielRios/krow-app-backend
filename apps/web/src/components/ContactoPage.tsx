'use client';
import { useState, type FormEvent } from 'react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { contactDraft, publicConfig } from './public-config';
import './landing.css';
import './pages.css';

export default function ContactoPage() {
  const [draft, setDraft] = useState<string | null>(null);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicConfig.supportEmail) return;
    const form = new FormData(event.currentTarget);
    setDraft(
      contactDraft(publicConfig.supportEmail, {
        name: String(form.get('name') ?? '').trim(),
        sender: String(form.get('email') ?? '').trim(),
        topic: String(form.get('topic') ?? ''),
        message: String(form.get('message') ?? '').trim(),
      }),
    );
  }
  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <p className="eyebrow">Contacto</p>
        <h1>Hablemos</h1>
        <p>
          Consulta al equipo del piloto sobre dudas, sugerencias o problemas con
          un viaje.
        </p>
      </section>
      <main className="content">
        <div className="content-grid">
          {publicConfig.supportEmail ? (
            <form
              className="form-card"
              onSubmit={handleSubmit}
              onChange={() => setDraft(null)}
            >
              <h2>Prepara tu mensaje</h2>
              <p>
                Se abrirá tu aplicación de correo para que revises y envíes el
                mensaje.
              </p>
              <div className="field">
                <label htmlFor="name">Nombre</label>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={120}
                />
              </div>
              <div className="field">
                <label htmlFor="email">Correo electrónico</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </div>
              <div className="field">
                <label htmlFor="topic">Asunto</label>
                <select id="topic" name="topic" defaultValue="Consulta general">
                  <option>Consulta general</option>
                  <option>Soporte / problema con un viaje</option>
                  <option>Interesado en KROW para empresas</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="message">Mensaje</label>
                <textarea
                  id="message"
                  name="message"
                  required
                  maxLength={3000}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Preparar correo
              </button>
              {draft && (
                <div className="form-status" role="status">
                  <p>
                    Tu borrador está listo. Envíalo desde tu aplicación de
                    correo.
                  </p>
                  <a className="btn btn-primary" href={draft}>
                    Abrir borrador
                  </a>
                </div>
              )}
            </form>
          ) : (
            <article className="form-card">
              <h2>Contacto del piloto</h2>
              <p>
                {publicConfig.supportUrl
                  ? 'Usa el canal del equipo para pedir ayuda o enviar tus comentarios.'
                  : 'El canal de contacto del piloto aún no está publicado. Consulta al equipo que te proporcionó acceso a KROW.'}
              </p>
              {publicConfig.supportUrl && (
                <a className="btn btn-primary" href={publicConfig.supportUrl}>
                  Contactar al equipo
                </a>
              )}
            </article>
          )}
          <div className="contact-info">
            {publicConfig.supportEmail && (
              <div className="item">
                <span className="icon" aria-hidden="true">
                  ✉
                </span>
                <div>
                  <h2>Correo</h2>
                  <a href={`mailto:${publicConfig.supportEmail}`}>
                    {publicConfig.supportEmail}
                  </a>
                </div>
              </div>
            )}
            <div className="item">
              <span className="icon" aria-hidden="true">
                ⌖
              </span>
              <div>
                <h2>Comunidad piloto</h2>
                <p>
                  Instituto Tecnológico de Nuevo León · Guadalupe, Nuevo León,
                  México.
                </p>
              </div>
            </div>
            <div className="item">
              <span className="icon" aria-hidden="true">
                i
              </span>
              <div>
                <h2>Tu viaje</h2>
                <p>
                  Para coordinar una reserva confirmada, utiliza el chat con el
                  conductor o pasajero desde la app.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
