import { publicConfig } from './public-config';

export function CtaBanner() {
  return (
    <div className="cta-banner">
      <h2>¿Listo para compartir tu próximo viaje?</h2>
      <p>
        El piloto de KROW comienza con la comunidad del Instituto Tecnológico de
        Nuevo León.
      </p>
      <a
        href={publicConfig.androidDownloadUrl ?? '/contacto'}
        className="btn btn-primary"
      >
        {publicConfig.androidDownloadUrl
          ? 'Probar en Android'
          : 'Información del piloto'}
      </a>
    </div>
  );
}
