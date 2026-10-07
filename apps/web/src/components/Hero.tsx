import { publicConfig } from './public-config';

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <div className="brand-mark">
          <img src="/img/Logo_KROW.png" alt="" />
          <span>KROW</span>
        </div>
        <h1>Comparte el camino, no el costo</h1>
        <p>
          KROW conecta conductores y pasajeros que ya van hacia el mismo lugar,
          para compartir el trayecto desde el Instituto Tecnológico de Nuevo
          León.
        </p>
        <div className="hero-actions">
          <a
            href={publicConfig.androidDownloadUrl ?? '#como-funciona'}
            className="btn btn-primary"
          >
            {publicConfig.androidDownloadUrl
              ? 'Probar en Android'
              : 'Conoce el piloto'}
          </a>
          <a href="#como-funciona" className="btn btn-outline">
            Cómo funciona
          </a>
        </div>
      </div>
      <div className="hero-photo">
        <img
          src="/img/Viaje_KROW.jpg"
          alt="Interior de un vehículo durante un trayecto"
        />
      </div>
    </section>
  );
}
