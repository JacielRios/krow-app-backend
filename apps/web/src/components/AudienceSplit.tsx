'use client';

import { useState } from 'react';

const CONTENT = {
  pasajeros: [
    'Encuentra viajes desde el Instituto Tecnológico de Nuevo León hacia tu destino.',
    'Mira el perfil y calificación del conductor antes de confirmar.',
    'Consulta el vehículo y tu parada en el mapa durante el viaje con conexión a internet.',
  ],
  conductores: [
    'Cubre parte de tus gastos de gasolina con cada viaje que ya ibas a hacer.',
    'Elige a tus pasajeros y los horarios que más te convengan.',
    'Recibe el pago en efectivo y registra su recepción desde la app.',
  ],
} as const;

export function AudienceSplit() {
  const [tab, setTab] = useState<keyof typeof CONTENT>('pasajeros');
  return (
    <section className="audience" id="para-quien">
      <div className="section-head">
        <p className="eyebrow">Para ti</p>
        <h2>Ya seas pasajero o conductor</h2>
      </div>
      <div className="audience-tabs" role="group" aria-label="Elegir audiencia">
        <button
          type="button"
          aria-pressed={tab === 'pasajeros'}
          onClick={() => setTab('pasajeros')}
        >
          Pasajeros
        </button>
        <button
          type="button"
          aria-pressed={tab === 'conductores'}
          onClick={() => setTab('conductores')}
        >
          Conductores
        </button>
      </div>
      <div className="audience-panel" aria-live="polite">
        <ul>
          {CONTENT[tab].map((line) => (
            <li key={line}>
              <span className="dot" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
