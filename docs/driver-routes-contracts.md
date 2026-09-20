# Rutas, viajes y reservas

Este contrato es incremental sobre el esquema Supabase existente. Una ruta
frecuente es una plantilla sin fecha; cada viaje conserva su propia instantánea
de recorrido, paradas, vehículo, cupo y precio. Cambiar la plantilla no cambia
viajes ya publicados.

Todos los endpoints requieren un bearer token de Supabase. El móvil consulta
Google Places y Directions únicamente a través de NestJS. La API no acepta
el polyline del móvil como fuente de verdad: vuelve a solicitar Directions
antes de publicar o editar.

## Rutas frecuentes

- `POST /v1/routes/preview`: `{ origin: {lat,lng}, destination: {lat,lng},
  departureTime? }`. Responde polyline, distancia, duración y
  `compatibleStops` ordenadas por avance, a un máximo de 500 m de la ruta.
- `GET /v1/routes/favorites` y `GET /v1/routes/favorites/:routeId`:
  devuelve plantillas del conductor autenticado, incluyendo
  `hasStaleStops`.
- `POST /v1/routes/favorites` y `PATCH /v1/routes/favorites/:routeId`:
  reciben nombre, origen/destino con dirección, coordenadas y Place ID
  opcional, `transportStopIds` (mínimo dos únicas) y los valores
  predeterminados opcionales `defaultVehicleId`,
  `defaultAvailableSeats`, `defaultPricePerSeatCents`.
- `DELETE /v1/routes/favorites/:routeId`: elimina solo la plantilla.

## Viajes del conductor

- `POST /v1/rides`: vehículo, origen/destino, direcciones, fecha futura,
  `transportStopIds`, `favoriteRouteId?`, `availableSeats` y
  `pricePerSeatCents`. La base crea el viaje, sus paradas y el historial en
  una transacción.
- `GET /v1/rides/mine?status=&limit=50&offset=0`: viajes propios paginados.
- `GET /v1/rides/:rideId`: instantánea con vehículo, paradas, `version`,
  `canEdit` y `editBlockReason`.
- `PUT /v1/rides/:rideId`: misma instantánea editable que la creación más
  `version`. Devuelve `409` si cambió la versión o entró una reserva activa.
  Solo se edita un viaje `scheduled` sin reservas
  `pending|confirmed|in_progress`.
- Los endpoints existentes de iniciar, cancelar y finalizar siguen vigentes,
  al igual que `/mine/recent` y `/mine/active`.

La capacidad del vehículo incluye al conductor; el máximo ofertable es
`capacity - 1`. La favorita se revalida en cada publicación.

## Búsqueda y reserva del pasajero

- `POST /v1/rides/search`: `{origin:{lat,lng},destination:{lat,lng}}`.
  Cada resultado tiene `bestPickupStop`, `bestDropoffStop` y distancias.
  Solo coinciden paradas activas del catálogo a 500 m de los puntos solicitados,
  con subida anterior a bajada.
- `POST /v1/rides/:rideId/stop-options`: mismo origen/destino; devuelve
  `pairs` válidos para escoger en mapa/lista.
- `POST /v1/rides/:rideId/bookings`:
  `{pickupStopId,dropoffStopId,seats}`. La base comprueba viaje, versión de
  paradas, actividad, orden, cupo y una sola reserva activa por pasajero.

## Despliegue y datos pendientes

Las migraciones `driver_routes_and_stops` y `harden_driver_routes` ya están
registradas en el proyecto Supabase. Desplegar el backend antes del nuevo
móvil. Las RPC antiguas siguen disponibles temporalmente para clientes
existentes; retirarlas solo después de confirmar que no reciben tráfico.

El catálogo permanece vacío hasta importar el CSV real de KROW con
`npm run stops:import -- <archivo.csv>` (véase
`docs/transport-stops-import.md`). Sin catálogo, la publicación y la
reserva por este flujo muestran su estado vacío. Android necesita una clave
separada del Maps SDK en `KROW_ANDROID_MAPS_API_KEY`, restringida por
`com.krownmobileapp` y el SHA de firma; no reutilizar la clave REST de
NestJS.
