"use client";

import { useState } from "react";

const CONTENT = {
  pasajeros: [
    "Encuentra viajes hacia tu destino a menor costo que un taxi o app de transporte.",
    "Mira el perfil y calificación del conductor antes de confirmar.",
    "Comparte tu ubicación en vivo con quien tú decidas durante el viaje.",
  ],
  conductores: [
    "Cubre parte de tus gastos de gasolina con cada viaje que ya ibas a hacer.",
    "Elige a tus pasajeros y los horarios que más te convengan.",
    "Pagos gestionados dentro de la app, sin manejar efectivo.",
  ],
} as const;

export function AudienceSplit() {
  const [tab, setTab] = useState<keyof typeof CONTENT>("pasajeros");
  return (
    <section className="audience" id="para-quien">
      <div className="section-head">
        <p className="eyebrow">Para ti</p>
        <h2>Ya seas pasajero o conductor</h2>
      </div>
      <div className="audience-tabs" role="tablist" aria-label="Elegir audiencia">
        <button role="tab" aria-selected={tab === "pasajeros"} onClick={() => setTab("pasajeros")}>
          Pasajeros
        </button>
        <button role="tab" aria-selected={tab === "conductores"} onClick={() => setTab("conductores")}>
          Conductores
        </button>
      </div>
      <div className="audience-panel">
        <ul>
          {CONTENT[tab].map((line) => (
            <li key={line}><span className="dot" aria-hidden="true" />{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
