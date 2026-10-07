export function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <div className="brand-mark">
          <img src="/img/Logo_KROW.png" alt=""/>
          <span>KROW</span>
        </div>
        <h1>Comparte el camino, no el costo</h1>
        <p>
          KROW conecta conductores y pasajeros que ya van hacia el mismo lugar,
          para viajar más barato, más seguro y con menos autos en la calle.
        </p>
        <div className="hero-actions">
          <a href="/registro" className="btn btn-primary">Comenzar ahora</a>
          <a href="/sobre-nosotros" className="btn btn-outline">Cómo funciona</a>
        </div>
      </div>
      <div className="hero-photo">
        {/* Reemplaza por la foto que ya tienes del tablero del auto */}
        <img src="/img/Viaje_KROW.jpg" alt="Conductor usando KROW en su auto" />
      </div>
    </section>
  );
}
