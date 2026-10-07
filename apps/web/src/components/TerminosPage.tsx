import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { publicConfig } from './public-config';
import './landing.css';
import './pages.css';

export default function TerminosPage({
  privacy = false,
}: {
  privacy?: boolean;
}) {
  const title = privacy ? 'Privacidad' : 'Términos del piloto';
  const officialUrl = privacy ? publicConfig.privacyUrl : publicConfig.termsUrl;
  return (
    <div className="landing">
      <Navbar />
      <main className="legal">
        <p className="eyebrow">Información del piloto</p>
        <h1>{title}</h1>
        {officialUrl ? (
          <>
            <p>
              Consulta el documento publicado por el equipo responsable de KROW.
            </p>
            <a className="btn btn-primary" href={officialUrl}>
              Abrir {privacy ? 'aviso de privacidad' : 'términos'}
            </a>
          </>
        ) : (
          <>
            <p>
              El {privacy ? 'aviso de privacidad' : 'documento de términos'}{' '}
              aprobado para el piloto aún no está publicado. Esta página informa
              sobre las funciones actuales; no sustituye ese documento.
            </p>
            <h2>
              {privacy ? 'Seguimiento de ubicación' : 'Cómo funciona el piloto'}
            </h2>
            <p>
              {privacy
                ? 'El conductor comparte su ubicación durante un viaje activo. Los participantes autorizados pueden consultar el vehículo y sus paradas. Al terminar el viaje, se detiene la captura de ubicación.'
                : 'KROW permite publicar y reservar viajes compartidos desde el Instituto Tecnológico de Nuevo León. El conductor confirma la subida y la bajada de los pasajeros.'}
            </p>
            <h2>{privacy ? 'Cuenta y comunicación' : 'Reservas y pagos'}</h2>
            <p>
              {privacy
                ? 'La cuenta, las reservas, los mensajes del chat y las reseñas se usan para coordinar los viajes. Los plazos de conservación y el canal para ejercer derechos requieren la política aprobada del equipo responsable.'
                : 'El precio se consulta antes de reservar. Durante el piloto se paga en efectivo y el conductor registra su recepción. No se ofrecen pagos con tarjeta.'}
            </p>
            <p>
              Consulta al equipo que te proporcionó acceso antes de incorporar
              datos de usuarios reales al piloto.
            </p>
          </>
        )}
        <p>
          <a href="/contacto">Información de contacto</a>
        </p>
      </main>
      <Footer />
    </div>
  );
}
