const STEPS = [
  {
    title: 'Crea tu cuenta',
    text: 'Regístrate en la app; una misma cuenta puede viajar como pasajero o conductor autorizado.',
  },
  {
    title: 'Encuentra o publica un viaje',
    text: 'Busca rutas compatibles o publica la tuya si manejas.',
  },
  {
    title: 'Viaja y califica',
    text: 'Comparte el trayecto y deja tu calificación al terminar.',
  },
];

export function HowItWorks() {
  return (
    <section className="how" id="como-funciona">
      <div className="section-head">
        <p className="eyebrow">Cómo funciona</p>
        <h2>Un trayecto compartido, paso a paso</h2>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="num">{i + 1}</div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
