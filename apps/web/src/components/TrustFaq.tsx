const FAQS = [
  { q: "¿Los conductores están verificados?", a: "Sí, todos pasan por un proceso de verificación de identidad y documentos antes de poder publicar viajes." },
  { q: "¿Qué pasa si cancelo un viaje?", a: "Puedes cancelar desde la app; las políticas de cancelación se muestran antes de confirmar cada viaje." },
  { q: "¿Cómo se manejan los pagos?", a: "Todas las tarifas de pago se gestiona dentro de la plataforma, ya sea efectivo o tarjeta." },
];

export function TrustFaq() {
  return (
    <section className="trust" id="preguntas">
      <div className="section-head">
        <p className="eyebrow">Confianza y seguridad</p>
        <h2>Preguntas frecuentes</h2>
      </div>
      <div className="faq">
        {FAQS.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
