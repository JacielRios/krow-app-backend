import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import "/Dev/krow-app-backend/apps/web/src/components/landing.css";
import "/Dev/krow-app-backend/apps/web/src/components/pages.css";

export default function TerminosPage() {
  return (
    <div className="landing">
      <Navbar />
      <div className="legal">
        <p className="updated">Última actualización: [pendiente de definir con tu equipo legal]</p>
        <h1 style={{ fontSize: 28 }}>Términos y condiciones</h1>

        <h2>1. Aceptación de los términos</h2>
        <p>
          [Placeholder] Al registrarte o usar KROW, aceptas estos términos y condiciones.
          Reemplaza este texto con el contenido legal definitivo revisado por tu equipo.
        </p>

        <h2>2. Uso del servicio</h2>
        <p>
          [Placeholder] Describe aquí qué está permitido y qué no dentro de la plataforma,
          responsabilidades de conductores y pasajeros, y reglas de conducta.
        </p>

        <h2>3. Pagos y cancelaciones</h2>
        <p>
          [Placeholder] Explica cómo funcionan los cobros, reembolsos y políticas de cancelación.
        </p>

        <h2>4. Responsabilidad</h2>
        <p>
          [Placeholder] Alcance de la responsabilidad de KROW como plataforma intermediaria
          entre conductores y pasajeros.
        </p>

        <h2>5. Contacto</h2>
        <p>
          Para dudas sobre estos términos, escríbenos a{" "}
          <a href="mailto:contacto@krow.app">contacto@krow.app</a>.
        </p>
      </div>
      <Footer />
    </div>
  );
}
