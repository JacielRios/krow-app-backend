# Piloto: avenidas, paradas seleccionadas y búsqueda por destino

## Flujos implementados

Conductor: ITNL fijo → destino → avenida del catálogo → mapa/lista de paradas
compatibles → selección manual de bajadas → horario, vehículo, cupo y precio →
revisión → publicación. Se exige al menos una bajada; la salida central del ITNL
se agrega en el servidor. Las favoritas conservan la avenida y la selección.

Pasajero: destino → búsqueda de viajes → resultados ordenados por cercanía del
mejor descenso → detalle con ruta, destino solicitado y paradas habilitadas →
selección de bajada → reserva. No necesita seleccionar origen ni descenso antes
de buscar. Una recomendación no impide elegir otra parada habilitada del viaje.

La ruta Google atraviesa las referencias viables de la avenida. Estas referencias
guían la geometría; únicamente las paradas seleccionadas por el conductor se
habilitan para reservas. El GPS de los viajes con avenida conserva esa geometría
publicada y calcula la ETA aproximada con el progreso del vehículo; el servicio
de ubicación nativo y sus permisos no cambian.

## Modelo de datos

| Relación | Implementación |
| --- | --- |
| Avenida | Nueva `transport_corridors`: UUID, código, nombre, dirección general, activo y orden de presentación. |
| Avenida → parada | `transport_stops.corridor_id`, `corridor_order` y `direction`, además de nombre, coordenadas, tipo, fuente y activo existentes. |
| Avenida → viaje/favorita | `rides.corridor_id` y `favorite_routes.corridor_id`. Son nullable para preservar registros anteriores. |
| Viaje → selección del conductor | `ride_stops` existente, con versión, activo y orden. No se habilita todo el catálogo. |
| Favorita → selección del conductor | `favorite_route_stops` existente. |
| Reserva → elección del pasajero | `bookings.pickup_stop_id` y `dropoff_stop_id` existentes, referidos a las paradas concretas del viaje. |

El catálogo inicial tiene tres avenidas y 18 puntos de descenso: siete en Eloy
Cavazos, seis en Pablo Livas y cinco en Reynosa. Se conservan tres referencias del
ITNL; la central se usa como salida automática de los nuevos viajes.

Catorce descensos son referencias previamente geocodificadas. Cuatro son paradas
publicadas por el municipio en [Ruta Azul](https://nosmueve.guadalupe.gob.mx/rutas/ruta-azul)
y [Ruta Naranja](https://nosmueve.guadalupe.gob.mx/rutas/ruta-naranja): San Sebastián,
Pablo Livas, Eloy Cavazos/México 86 y Enredadera junto a Reynosa. La asignación de
San Sebastián y Enredadera a una avenida se infiere por proximidad geográfica.
El sentido de circulación y la acera de los puntos municipales siguen sin
confirmarse en campo; sus coordenadas no certifican condiciones de embarque.
La procedencia completa está en `data/public-transit-pilot-20261007.json`.

## Contratos

- `GET /v1/routes/corridors`: catálogo activo con paradas y coordenadas.
- `POST /v1/routes/preview`: acepta `corridorId` y selección opcional
  `transportStopIds`; devuelve ruta y catálogo viable para ese destino.
- Crear/editar viaje y guardar favorita: `corridorId` y IDs seleccionados. NestJS
  calcula la ruta y valida el catálogo; el cliente no escribe geometría en BD.
- `POST /v1/rides/search`: destino, fechas y límite existentes; origen ITNL fijo.
- `POST /v1/rides/:rideId/stop-options`: todos los descensos activos de la versión
  del viaje, sus distancias al destino y `recommendedDropoffStopId`.

Se agregan RPC de lectura `search_available_rides_pilot` y
`get_ride_stop_options_pilot`, conservando las entradas anteriores. Los wrappers
públicos usan SECURITY INVOKER y delegan en funciones privadas que verifican
identidad y cuenta activa. La tabla nueva tiene RLS y lectura autenticada
explícita. Crear/editar/favoritas siguen restringidos al rol privado de la API,
con validación de propietario, vehículo, cupo, versión y reservas.

## Emparejamiento y distancia

1. Revisar viajes futuros programados con cupo, conductor aprobado, vehículo
   activo y salida ITNL; excluir los del propio pasajero.
2. Considerar únicamente los descensos habilitados, activos y de la versión
   vigente, posteriores a la salida. Los históricos sin avenida mantienen una
   adaptación de salida cercana al origen sin mover reservas.
3. Calcular distancia geodésica aproximada con Haversine entre cada descenso y
   el destino solicitado.
4. Elegir el mejor descenso por viaje y admitir el viaje si está dentro del radio
   configurado. Ordenar por esa distancia, después por salida y UUID como
   desempate; aplicar el límite después de ordenar.
5. En detalle, mostrar todas las bajadas disponibles del viaje, incluso las que
   estén fuera del radio de emparejamiento. Reservar verifica pertenencia, orden,
   disponibilidad y estado, sin imponer cercanía al destino solicitado.

`PILOT_MATCHING_MAX_DISTANCE_METERS=3000` es el valor predeterminado del backend.
Puede ajustarse entre 100 y 20000 en el entorno sin recompilar la app. Una consulta
API puede especificar `maxDistanceMeters`; la app usa el valor del servidor.
Así, 300 m, 800 m y 1.5 km aparecen en ese orden. Las distancias se muestran como
aproximadas en línea recta; no representan distancia caminando ni una ruta peatonal.

## Ampliación pendiente

- Comprobar físicamente acera, sentido, acceso y puntos de reunión de las paradas.
- Ampliar `transport_corridors` y asociar paradas activas con su orden: la app
  consulta el catálogo y no necesita una lista de avenidas en las pantallas.
- Definir orígenes y áreas de cobertura adicionales antes de retirar la regla ITNL.
- Gestionar avenidas desde el panel del equipo administrativo y ampliar el importador.
- Dividir rutas con más de 23 referencias para respetar el proveedor de mapas.
- Incorporar distancias peatonales y navegación asistida si el piloto lo requiere.
- Certificar los nuevos flujos y seguimiento en Android físico e iOS.

La migración conserva viajes, reservas y selección histórica. Los nuevos controles
de publicación requieren instalar la versión móvil que incluye el selector de
avenidas. Firma productiva y validación física siguen siendo hitos separados.

## Verificación y publicación

- Migración aplicada en Supabase: `20261007204727_pilot_corridor_selected_stops`.
  El ledger local contiene el cuerpo aplicado y su comprobación aprueba 38 entradas.
  Se conservan 50 viajes, 34 reservas y una favorita; quedan 21 referencias de
  transporte en total, incluyendo las tres del ITNL.
- RLS activo para el catálogo nuevo, sin lectura anónima ni escritura del cliente.
  La revisión de seguridad de Supabase no agrega avisos respecto al estado previo.
- Backend: 150 pruebas y seis E2E aprobados; 13 pruebas adicionales que necesitan
  una base PostgreSQL de pruebas permanecen omitidas. TypeScript, lint y build
  aprobados. La suite de nueve pruebas SQL del nuevo modelo está incluida en las
  150 y se repitió después de reconciliar el nombre de la migración.
- Móvil: 172 pruebas, TypeScript y compilación Android trial aprobados.
  APK `0.2.2-trial`, código 4, con la firma de prueba anterior. La evidencia de
  compilación está en el repositorio móvil, en
  `docs/android-apk-pilot-corridors-20261007.json`.
- Railway: despliegue `84ea0254-61a3-48f4-91ce-cd4fd9aa8d6f`, estado `SUCCESS`.
  API: https://krow-api-production.up.railway.app/v1.
  El entorno fija `PILOT_MATCHING_MAX_DISTANCE_METERS=3000`.
- Verificación HTTP autenticada de la API publicada: catálogo, rutas Google de
  las tres avenidas, rechazo de paradas de otra avenida y búsqueda por destino.
  La separación máxima observada entre referencias y ruta es de 27 metros.
  La evidencia está en `pilot-corridors-live-20261007.json`. No había viajes futuros
  compatibles durante esta comprobación HTTP.
- Ensayo adicional en PostgreSQL/PostGIS real, con el mismo rol limitado de la API
  y geometría Google: publicación de tres viajes con una bajada seleccionada cada
  uno, salida ITNL automática y orden por distancias de 0, 1240 y 2479 metros antes
  del horario y límite. Cambiar el radio a 1000 metros deja solamente el primero.
  Un cuarto viaje ofreció bajadas a 0 y 4404 metros; reservar la lejana funcionó y
  conservó el importe de 1234 centavos. La transacción terminó con `ROLLBACK` y se
  verificaron conteos idénticos antes y después, incluyendo viajes, reservas,
  paradas, precios y outbox. Evidencia: `pilot-corridors-database-20261007.json`.
  No se ampliaron permisos ni se modificaron conductores, vehículos o catálogo.
- Instalación, interacción de mapas y seguimiento en un teléfono físico siguen
  pendientes; estas comprobaciones no sustituyen un recorrido en carretera.
