# KROW · Administración de paradas con Google Maps

Actualización del 21 de octubre de 2026 en `/admin/paradas`. Sustituye el mapa Leaflet/OpenStreetMap publicado previamente por Google Maps JavaScript API y Places API (New). La publicación de esta revisión requiere configurar la clave web en Vercel; no se debe promover una compilación sin esa variable.

## Arquitectura y alcance

La web utiliza Next.js 16.3.8, React 19.3.0, estilos propios, `AdminDialog`, `StatusBadge` y los hooks autenticados `useAdminApi`/`useAdminResource`. El backend ya emplea Google Maps para direcciones, búsquedas y ubicaciones mediante una clave privada. Esa credencial no se reutiliza ni se expone al navegador.

`transport_stops` almacena coordenadas, estado, identificador, nombre, dirección, municipio, tipo, avenida, orden y sentido. El catálogo administrativo y el guardado conservan sus endpoints `GET/POST /v1/admin/transport-stops` y `PATCH /:stopId`, autorización, auditoría y validación transaccional existentes. Esta revisión no cambia API, esquema, migraciones ni reglas de selección/asignación de rutas.

## Funcionalidad

| Acción                   | Resultado                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consultar KROW           | Marcadores circulares para el catálogo guardado, activas sólidas e inactivas claras con borde discontinuo. Mapa, tabla y panel comparten filtros y selección.                                                                                                                                                             |
| Ver transporte de Google | Mapa y capa de transporte de Google; los puntos disponibles dependen de su cobertura. No se promete un inventario exhaustivo ni verificación en tiempo real.                                                                                                                                                              |
| Buscar referencias       | «Buscar paradas en esta zona» consulta `bus_stop` y `bus_station`, hasta 20 resultados a 1.5 km del centro y ordenados por distancia. Acercamiento mínimo 13. La búsqueda se hace a petición, sin consultas repetidas al desplazar el mapa.                                                                               |
| Seleccionar referencia   | Marcadores cuadrados con G y listado alternativo accesible. También se puede seleccionar un POI de autobús del mapa base. Nombre, dirección y coordenadas pasan a un borrador; el identificador KROW y la configuración operativa se completan en el formulario. No hay importación masiva ni guardado al pulsar el mapa. |
| Crear punto propio       | «Agregar parada» permite tocar cualquier ubicación o usar el centro con teclado. No requiere que Google la reconozca como parada. Elegir otro punto limpia las sugerencias de la referencia anterior. Se mantiene la entrada manual de coordenadas.                                                                       |
| Cambiar ubicación        | Un registro existente conserva sus datos al seleccionar otra posición; una referencia Google no reemplaza su identidad.                                                                                                                                                                                                   |
| Activar/desactivar       | Conserva confirmación, bloqueo de doble pulsación, lectura fresca del registro y protección del servidor ante reservas comprometidas.                                                                                                                                                                                     |
| Sincronizar              | Recarga el catálogo después del guardado confirmado, limpia filtros para mostrar la parada y actualiza al recuperar el foco. No se simula persistencia si el servidor falla.                                                                                                                                              |
| Errores                  | Clave ausente/rechazada, carga de SDK fallida, búsqueda sin resultados y fallo de Places tienen mensajes específicos y alternativa manual. Se descartan respuestas después del desmontaje.                                                                                                                                |

## Componentes y dependencias

- `StopsMap.tsx`: SDK oficial de Google cargado después del montaje, `TransitLayer`, Places New, POI, marcadores mediante `OverlayView`, controles nativos de 44 px y limpieza de eventos. Los marcadores KROW mantienen sus nodos al cambiar la selección para conservar el foco. No requiere un Map ID adicional ni utiliza marcadores obsoletos.
- `google-maps-browser.ts`: carga compartida y asíncrona desde `maps.googleapis.com`, idioma español, región México, tiempo límite, reintento de red y detección de rechazo de autenticación.
- `page.tsx`, `StopEditor.tsx`, `transport-stops.ts`: borrador de referencia temporal, revisión del formulario y persistencia por los servicios existentes. No se convierte silenciosamente el Google Place ID en identificador operativo KROW.
- `stops.css`: presentación adaptable, estados por forma/texto/color, foco visible, controles y listado de referencias.
- Se eliminaron `leaflet`, `@types/leaflet` y sus tipos GeoJSON. Solo se añadió `@types/google.maps` 3.66.7 como dependencia de desarrollo; el SDK de ejecución se sirve directamente desde Google.
- Skills: `vercel:react-best-practices` y `vercel:env-vars`; se conservó el diseño y la arquitectura actuales.

## Configuración necesaria

En el mismo proyecto de Google Cloud de KROW:

1. Habilitar **Maps JavaScript API** y **Places API (New)** con la facturación ya configurada para ese proyecto.
2. Crear o usar una clave exclusiva para navegador, con restricción de aplicación por **sitios web / referentes HTTP**. Autorizar el dominio `https://krow-web-gamma.vercel.app/*` y solo los dominios adicionales que realmente se utilicen. Para desarrollo local, autorizar el origen local correspondiente; no abrir todos los dominios.
3. Limitar la clave a esas APIs. Las credenciales de Android, iOS y del backend conservan sus propias restricciones.
4. Configurar **NEXT_PUBLIC_GOOGLE_MAPS_API_KEY** en **Production** del proyecto **krow-web** de Vercel. Puede configurarse también en los entornos de prueba necesarios con sus dominios autorizados. Nunca copiar aquí la clave privada del backend.
5. Crear un nuevo despliegue después del cambio: Next.js incorpora las variables `NEXT_PUBLIC_*` durante la compilación. Guardar la variable sin reconstruir no actualiza un despliegue existente.

No se modificaron las restricciones de Google Cloud, los presupuestos ni las credenciales existentes. Las consultas a Google están acotadas y solo se solicitan campos necesarios. Los resultados de referencia permanecen en memoria de la pantalla.

## Validación

- Suite web completa: **14 archivos, 81 pruebas correctas**, incluyendo SDK, selección y persistencia autenticada con datos sintéticos.
- Cobertura específica: clave ausente sin fallback privado, deduplicación del SDK, fallos/reintento/timeout, estados KROW, filtro y foco, selección libre/centro, búsqueda acotada, referencias duplicadas, POI, ausencia de cobertura, fallo Places, desmontaje/StrictMode, revisión antes de guardar y limpieza de sugerencias al cambiar a un punto propio.
- TypeScript y compilación Next.js de producción verificados; formato y revisión de diferencias antes de entregar.
- Conservadas las regresiones PostgreSQL previas sobre paradas inactivas, reservas comprometidas y coordenadas de viajes publicados; no se cambió ese código en esta revisión.
- Revisión estructural de accesibilidad y comportamiento adaptable. La prueba visual real y la búsqueda contra Google quedan pendientes de la clave web y de un navegador habilitado: la herramienta local de navegador está desactivada en Work. Las pruebas de SDK utilizan dobles controlados, no acreditan autorización ni cobertura real de Google.

Fuentes oficiales: [carga del SDK](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Nearby Search](https://developers.google.com/maps/documentation/javascript/nearby-search), [tipos de lugares](https://developers.google.com/maps/documentation/places/web-service/place-types), [capa de transporte](https://developers.google.com/maps/documentation/javascript/trafficlayer), [selección de POI](https://developers.google.com/maps/documentation/javascript/examples/event-poi) y [OverlayView](https://developers.google.com/maps/documentation/javascript/customoverlays).
