# Cumplimiento KROW: primera etapa de implementación

Fecha: 20 de octubre de 2026. Alcance: reservas vigentes, publicación idempotente y actualización de consultas del piloto Android.

Los cambios se prepararon sobre los árboles de trabajo existentes de API y móvil. No se sustituyeron los cambios anteriores, el diseño ni las tecnologías. Las dos migraciones ya se aplicaron en Supabase y el APK privado 0.5.1 compiló. La API nueva sigue pendiente: Railway rechazó dos intentos con “Deploys have been paused temporarily”. La API anterior continúa disponible; el APK nuevo debe conservarse sin instalar hasta actualizar el servidor.

La [evidencia de activación](compliance-activation-20261020.json) distingue lo aplicado, lo comprobado y lo bloqueado.

## Trazabilidad de esta etapa

| Tarea del diagnóstico | Resultado local | Actividades relacionadas | Aceptación pendiente |
| --- | --- | --- | --- |
| T01: recorrido y cierre nativo | Se consultó ADB; no hay dispositivos conectados. Se ampliaron las regresiones automatizadas. | 3, 5, 8, 9 | Dos teléfonos, recorrido GPS y reproducción del incidente de apertura de rutas. |
| T02: vigencia de reservas | Trigger aplicado en Supabase y rechazo comprobado con rollback. El mapeo HTTP 409 está implementado en la API local. | 5, 6, 8 | Desplegar la API nueva y verificar su respuesta HTTP. |
| T03: publicación sin duplicados por reintento | Comprobante privado y creación atómica aplicados y verificados en Supabase; identificador persistido por cuenta incluido en móvil. | 2, 5, 6, 8 | Despliegue de API y prueba integral móvil/API reales. |
| T04: consistencia de listas | Invalidación compartida de viajes y actualización al recuperar el foco de la pestaña Viajes. Un error de refresco no transforma una mutación confirmada en fallida. | 2, 3, 4, 7 | Comprobación visual en dispositivo. |
| T15: documentación y evidencias | Este registro inicia la matriz de trazabilidad y documenta el contrato y la activación. | 1, 9 | Completar los demás compromisos y la evidencia física. |

Ninguna actividad académica completa pasa a “terminada” únicamente por estos cambios.

## Reserva vigente

`20261020191646_booking_departure_deadline.sql` agrega `private.validate_booking_departure` y el trigger `bookings_validate_departure`.

La comprobación usa `clock_timestamp()` en el momento de insertar. El bloqueo de la fila del viaje impide que un resultado de búsqueda antiguo autorice una reserva pasada. Las reservas históricas existentes no se modifican. La regla no cierra viajes atrasados ni altera la aceptación de reservas que ya existen.

La búsqueda móvil ya muestra el error del servidor y vuelve a consultar cupo y paradas. La regla protege también la inserción, no solo la búsqueda del cliente.

## Contrato de publicación

`POST /v1/rides` acepta el campo opcional `requestId`, UUID v4. Los clientes anteriores pueden omitirlo; solo los que lo envían reciben la garantía de idempotencia.

La aplicación guarda de forma segura la última identidad de publicación y su UUID para cada cuenta mediante Keychain/Keystore. No es una cola offline ni un borrador de formulario. Conservar la misma intención permite reutilizar el identificador después de un timeout o de perder el estado del proceso; modificar los datos representa una solicitud distinta.

Antes del envío se vuelve a comprobar la identidad de la sesión. El token queda vinculado a la cuenta que inició la publicación para evitar que una respuesta de almacenamiento tardía utilice la sesión de otra cuenta.

NestJS forma una identidad canónica con vehículo, avenida, favorita, destino, dirección, salida, cupo, precio y paradas solicitadas. No incluye la geometría, la fecha de cálculo del proveedor ni el origen o la polilínea ignorados del cliente.

1. Consulta `get_ride_publication` antes de acceder a Google Maps o revalidar el catálogo.
2. Si ya existe el comprobante con la misma intención, devuelve el viaje original.
3. Si el ID está asociado a otros datos, devuelve HTTP 409.
4. Si es nueva, calcula la ruta fuera de la transacción.
5. `create_ride_v2` serializa por usuario, vuelve a comprobar el comprobante e inserta viaje, paradas, historial y comprobante en la misma transacción.

Un cálculo fallido no reserva ni consume el identificador. Las solicitudes concurrentes conservan una sola publicación confirmada.

`20261020191658_ride_publication_idempotency.sql` crea `private.ride_publication_requests`. Tiene RLS, clave primaria por actor/solicitud, índice de la referencia al viaje y borrado en cascada cuando se elimina su usuario o viaje. No concede acceso directo a clientes ni al LOGIN limitado. No amplía el permiso de ejecución de la mutación existente.

La función de consulta es intencionalmente `SECURITY DEFINER`: comprueba `auth.uid()`, cuenta activa y propiedad del comprobante, usa `search_path=''` y solo devuelve el identificador propio. No devuelve la intención almacenada ni permite leer comprobantes ajenos. Anon no tiene permiso de ejecución. Debe mantenerse esta justificación al revisar los avisos de funciones privilegiadas de Supabase.

Los comprobantes permanecen mientras exista el viaje: no eliminarlos por caducidad para volver a aceptar un identificador ya utilizado. Esta protección no combina dos solicitudes distintas ni habilita reservas automáticas o recurrencia.

## Actualización de datos

El móvil conserva React Query. El helper `invalidateRideLists` actualiza las claves de viajes del conductor, actividad, recientes y viaje activo después de publicar, editar y cambiar estados del piloto. La edición invalida además su detalle y contexto.

La pestaña de actividad consulta de nuevo al recuperar el foco. Los fallos de refresco mantienen los datos disponibles; no revierten una publicación que el servidor ya confirmó. No se cambió la presentación visual ni se añadió una dependencia.

## Validación

Resultados ejecutados el 20 de octubre de 2026:

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| API completa con PostgreSQL temporal | 190 pruebas, 28 suites aprobadas | Incluye reservas vencidas, concurrencia de publicaciones con LOGIN limitado y acceso SQL directo, rollback, recuperación y permisos. Ninguna suite omitida en esta ejecución. |
| E2E HTTP de API | 6 pruebas aprobadas | Contratos HTTP y autorización con las sustituciones del entorno de pruebas; no usa servicios productivos. |
| Móvil completo | 208 pruebas, 35 suites aprobadas | Incluye reintento con el mismo ID, persistencia simulada entre cargas del módulo, cambio de cuenta, fallo de almacenamiento, fallo de refresco y consulta al recuperar el foco. |
| Compilación NestJS | Aprobada | `npm run build:api`. |
| Tipos y lint de API y móvil | Aprobados | TypeScript sin emisión y ESLint sin errores. |
| Ledger histórico | 45 migraciones recuperadas coinciden | Incluye las dos migraciones aplicadas de esta etapa, reconciliadas con las versiones asignadas por Supabase. |
| Compilación Android | APK privado 0.5.1-trial, código 8 | Firma y contenido comprobados con el verificador local; instalación retenida hasta actualizar la API. |
| Aceptación nativa/GPS | Pendiente | ADB no detectó dispositivos conectados. No se instaló el APK nuevo. |

La suite móvil tuvo un timeout aislado en una prueba GPS bajo carga simultánea. Esa suite aprobó por separado y la repetición completa aprobó las 208 pruebas sin ampliar sus tiempos límite. Esto no reemplaza la aceptación en teléfonos reales.

La batería automatizada SQL usa fixtures sintéticas en PGlite y PostgreSQL temporal de loopback. Su geometría es una sustitución controlada; no certifica Google Maps ni GPS en carretera.

Además, la [verificación SQL real](compliance-live-sql-20261020.json) aprobó diez comprobaciones de publicación y permisos en Supabase con el LOGIN limitado de la API, geometría Google previamente calculada y rollback obligatorio. El rechazo de reserva vencida se comprobó por separado sobre un viaje creado y revertido dentro de una transacción de Supabase: no había un viaje vencido elegible y el LOGIN limitado no puede cambiar la hora de salida. No se ampliaron permisos para la prueba. La comprobación del rol limitado para esta regla está cubierta por las pruebas en PostgreSQL aislado.

Después se conservaron 55 viajes, 37 reservas, 12 usuarios y 21 paradas; cero comprobantes de prueba quedaron almacenados. La [comprobación HTTP](compliance-http-20261020.json) confirmó health/readiness 200 y autorización 401 en la API anterior; no certifica el nuevo campo `requestId`, pendiente de desplegar.

Para ejecutar todas las pruebas de API con PostgreSQL temporal disponible, usando los binarios locales preparados:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-postgres-local.ps1 -AllApiTests
```

`-ExecutionPolicy Bypass` se limita a ese proceso y no cambia la política permanente de Windows. El script conserva/restaura las variables de prueba y detiene PostgreSQL al terminar. Sin `-AllApiTests` ejecuta las suites específicas de concurrencia y runtime. Los binarios pueden proporcionarse con `-PostgresBin`.

## Activación coordinada

1. Completado: migraciones ensayadas en bases aisladas. El histórico inicial de Supabase sigue incompleto; no ejecutar un `db push` general.
2. Completado: se aplicaron únicamente `20261020191646` y `20261020191658`, con comprobación posterior de permisos. El [ledger nuevo](migration-ledger-compliance-20261020.json) conserva los SQL aplicados. Los ledgers anteriores no se modificaron.
3. Pendiente por proveedor: desplegar la API compatible cuando Railway admita despliegues. Su readiness exige el trigger de vigencia habilitado y la función de recuperación accesible para el LOGIN de la API. La [página de estado de Railway](https://status.railway.com/) confirma el 20 de octubre una incidencia global de builds para todos los workspaces; los servicios ya desplegados siguen funcionando. No se cambiaron plan, cobro ni configuración.
4. Pendiente de API: verificar el nuevo contrato HTTP, recuperación de publicación y respuesta de conflicto para una reserva vencida.
5. Compilación completada: APK 0.5.1-trial. Instalación y distribución pendientes: una API anterior rechaza el nuevo campo del contrato.
6. Pendiente físico: ejecutar T01 en dos dispositivos y registrar versión, modelo, red, resultados y diagnósticos.

Las migraciones y API conservan compatibilidad con clientes anteriores que omiten `requestId`. No es necesario activar Mapbox/runtime, push ni cierre de cuenta para esta etapa.

Los advisors añaden una advertencia por la consulta privilegiada propia y una nota por RLS sin políticas de la tabla privada. Son decisiones explícitas: el cliente solo puede recuperar su comprobante y la tabla deniega todo acceso directo. Referencias: [funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) y [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Sigue presente la advertencia anterior de protección de contraseñas filtradas desactivada; esta etapa no cambió la configuración de Auth.

## Próxima etapa

Se continuó con los filtros de fecha y hora del pasajero, incluidos en el APK privado 0.5.2: la interfaz está conectada al contrato existente y sus pruebas aprobaron. La [evidencia HTTP](search-dates-http-20261020.json) confirma compatibilidad con la API publicada; sus búsquedas válidas devolvieron listas vacías. Los casos con resultados y límites se verificaron en SQL aislado. Falta aceptación visual en dispositivo.

El usuario aprobó el dominio existente y limitó la etapa siguiente a Android. Ya se publicaron la asociación y los respaldos de [enlaces Android](mobile-links-android-20261020.md). La redirección de Auth debe confirmarse manualmente en Supabase. También se implementó consulta parcial protegida de perfil y listas sin conexión, con límites documentados en el móvil. Push requiere crear y configurar Firebase; se preparó su guía Android. La recurrencia, invitaciones, enlaces independientes de reservas y el resto del plan permanecen pendientes. Los resultados de estas etapas no certifican el módulo completo ni la preparación para lanzamiento público.
