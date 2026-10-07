const FAQS = [
  {
    q: '¿Quién puede publicar viajes?',
    a: 'Una cuenta debe contar con perfil de conductor autorizado y vehículo registrado. Durante el piloto, el alta se realiza con el equipo responsable.',
  },
  {
    q: '¿Desde dónde salen los viajes?',
    a: 'Desde el Instituto Tecnológico de Nuevo León. Las paradas del recorrido permiten coordinar la subida y la bajada.',
  },
  {
    q: '¿Cómo se manejan los pagos?',
    a: 'El piloto usa efectivo. El precio se muestra antes de reservar y el conductor registra su recepción en la app.',
  },
  {
    q: '¿Qué necesito para seguir el vehículo?',
    a: 'Conexión a internet. La app indica si la posición deja de actualizarse. El seguimiento se limita a los participantes del viaje.',
  },
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
