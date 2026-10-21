# KROW · Administración de paradas desde el mapa

Implementación del 21 de octubre de 2026 en `/admin/paradas`. Los cambios están en el código local; no se publicó un despliegue ni se modificaron registros de producción.

## Arquitectura revisada

- La web usa Next.js 16.3.8, React 19.3.0, estilos propios, `AdminDialog`, `StatusBadge` y los hooks autenticados `useAdminApi`/`useAdminResource`.
- `public.transport_stops` almacena `latitude` y `longitude`, estado `active`, identificador externo, nombre, dirección, municipio, tipo, avenida, orden y sentido. La consulta administrativa devuelve tanto activas como inactivas.
- `GET /v1/admin/transport-stops` proporciona el catálogo. `POST` y `PATCH /:stopId` reutilizan `TransportStopsService` y la función transaccional `admin_upsert_transport_stop`, con sus validaciones, autorización y auditoría existentes.
- La aplicación móvil utiliza Mapbox nativo y Google Maps. Esas integraciones no proporcionan un mapa para el navegador. La web no tenía una biblioteca cartográfica interactiva; la vista previa de viajes es un dibujo SVG.
- La consulta de solo lectura al proyecto configurado confirmó 21 paradas, todas activas y con coordenadas válidas, y la protección de la función administrativa contra desactivar paradas reservadas. Las pruebas de inactivación y errores emplearon datos sintéticos.

## Funcionalidad implementada

| Acción | Comportamiento |
| --- | --- |
| Consultar | El mapa dibuja marcadores del catálogo registrado. Marcador y fila comparten selección y un panel presenta la información y las acciones. |
| Filtrar | Búsqueda, avenida y estado se aplican a la misma colección para mapa y tabla. Incluye vista sin resultados y acceso a registrar una parada. |
| Distinguir estados | Activas con marcador sólido; inactivas con marcador claro y borde discontinuo. La parada seleccionada tiene un contorno adicional. Etiquetas y leyenda explican los estados sin depender únicamente del color. |
| Agregar | El administrador entra en modo de selección, toca una ubicación o usa el centro del mapa con teclado, y revisa sus coordenadas. Un marcador ámbar identifica el borrador. Después completa el formulario y guarda explícitamente. |
| Cambiar ubicación | El panel permite elegir otra posición y llevarla al editor, conservando los demás campos. No se guarda al tocar el mapa. |
| Activar/desactivar | Confirmación con el diálogo existente, bloqueo de pulsaciones repetidas y estado de guardado. Se vuelve a consultar el registro antes de enviar el cuerpo completo requerido por el endpoint, para reducir el riesgo de reenviar campos desactualizados. El endpoint existente no ofrece control de concurrencia por versión. |
| Sincronizar | Solo tras confirmar el guardado en el servidor se recarga el catálogo común. No se insertan marcadores persistentes ficticios ni se cambia el estado cuando el servidor rechaza la operación. Al guardar información se limpian los filtros para mostrar la parada seleccionada. También se actualiza al recuperar el foco de la ventana. |
| Recuperar errores | Mensajes del servidor dentro del diálogo, reintento de carga del catálogo y del mapa, aviso de fallo del mapa base y alternativa para ingresar coordenadas manualmente. |

## Compatibilidad con viajes existentes

No se cambiaron endpoints, DTO, asignación de rutas, selección móvil, permisos, funciones SQL ni migraciones.

`RoutesService.corridors` ya filtra avenidas y paradas activas; las funciones de publicación y opciones de pasajeros comprueban la vigencia del catálogo. La desactivación administrativa sigue bloqueada cuando hay reservas `pending`, `confirmed` o `in_progress` en viajes `scheduled`, `full` o `in_progress`. El mapa muestra el rechazo original y conserva el estado real.

Los viajes publicados guardan sus propias coordenadas en `ride_stops`. Se agregó una regresión de PostgreSQL que mueve el punto del catálogo mientras el viaje está `in_progress` y comprueba que identificadores, coordenadas, dirección y orden de sus paradas permanecen iguales. Se conservaron las pruebas sobre exclusión de inactivas, reservas comprometidas, selección explícita y compatibilidad con viajes antiguos.

## Componentes y dependencias

- `apps/web/src/components/admin/StopsMap.tsx`: integración aislada de Leaflet, marcadores, selección, teclado, ajuste del encuadre, cambio de tamaño y recuperación de errores. La biblioteca se importa después del montaje para evitar evaluar APIs del navegador durante SSR. Mantiene los marcadores al cambiar la selección, conservando el foco.
- `StopEditor.tsx`: extracción del formulario existente, coordenadas precargadas desde el mapa, validación, campos agrupados y estados de guardado.
- `apps/web/src/app/admin/paradas/page.tsx` y `stops.css`: coordinación, panel de detalle, filtros y presentación adaptable.
- `apps/web/src/lib/transport-stops.ts`: tipos compartidos de la web y representación del cuerpo existente de guardado.
- Nueva dependencia de ejecución: **Leaflet 1.9.4**, versión estable indicada por su [documentación oficial](https://leafletjs.com/download.html). Tipos de desarrollo `@types/leaflet 1.9.21`, con su dependencia de tipos GeoJSON. No se añadieron otros motores de mapas ni una biblioteca de componentes.
- Mapa base de OpenStreetMap con atribución visible, HTTPS, caché y referente normales del navegador, sin descargas masivas ni una clave adicional. El servicio público tiene disponibilidad sin SLA y [política de uso](https://operations.osmfoundation.org/policies/tiles/); para una operación que necesite garantías, deberá usarse un proveedor de teselas con el servicio correspondiente. Los elementos dibujados en el mapa base no se importan al catálogo ni son paradas administrables.
- Skills aplicadas: `supabase:supabase` para revisar catálogo y autorización, `vercel:react-best-practices` para revisar componentes y `vercel:verification` para trazar interfaz → API → persistencia → recarga.

## Validación

| Comprobación | Resultado |
| --- | --- |
| TypeScript web | Correcto. |
| Suite web completa | 13 archivos, 71 pruebas correctas. |
| Pruebas de la funcionalidad | 16 pruebas de página y Leaflet real: selección, filtros, alta desde mapa, entrada manual, cancelación, errores, estados, doble pulsación, movimiento, foco, reintento de teselas y limpieza de StrictMode. |
| Regresiones PostgreSQL | 2 suites, 24 pruebas correctas, con datos aislados. |
| Compilación de producción | `npm run build:web` correcto, incluida la generación de `/admin/paradas` y TypeScript. |
| Dependencias | Comparación con el lockfile previo: únicamente Leaflet y sus dos paquetes de tipos añadidos. |
| Espacios/formato | Prettier sobre los archivos trabajados; `git diff --check` correcto. |
| Tamaños y accesibilidad | Revisión estructural de columnas adaptables, tabla con desplazamiento, controles de 44 px, nombres accesibles, selección con teclado, estado textual, foco, reducción de animación y contenido del diálogo desplazable. |

Las evidencias de comandos están en `.tmp/admin-stops-map-20261021/`. Se ajustó la carpeta temporal y se usó un trabajador para evitar un fallo de caché de Vitest en el aislamiento. La compilación de Next.js requirió salir del aislamiento tras un error `EPERM` al crear archivos de salida; después finalizó correctamente.

La inspección visual real en navegador queda pendiente: la herramienta devolvió **“Local browser use is disabled in Work settings”**. Se preparó una vista local con datos sintéticos y se cerró su servidor al detectar esa restricción. No se presentan capturas ni se afirma una prueba visual o un recorrido conectado de extremo a extremo en producción. Las pruebas de componentes y de PostgreSQL cubren esos límites por separado.
