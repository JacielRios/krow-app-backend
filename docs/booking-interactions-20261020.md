# Solicitudes, confirmaciones y chat de KROW

Fecha: 20 de octubre de 2026. Alcance: correcciones funcionales y experiencia de solicitud conductor–pasajero, conservando React Native, React Query, NestJS, PostgreSQL y FCM existentes. La preparación nativa continúa limitada a Android; los componentes compartidos conservan convenciones de teclado y tema de iOS, sin declarar una compilación o aceptación iOS.

Etapa posterior: [permisos al abrir, recurrencia, invitaciones compartidas y recordatorios](permissions-recurrence-20261020.md), incorporados en 0.7.0. Este informe conserva la evidencia de la etapa 0.6.0 y sus pendientes en ese momento.

## Decisiones y cambios

**Viaje activo.** La API podía resolver `null` cuando no había viaje; NestJS enviaba un cuerpo vacío y el cliente intentaba interpretarlo como JSON. Se definió HTTP 204 para este caso y el cliente lo convierte en `null` sin parsear. Los errores reales de red/servidor siguen siendo errores. Las consultas se vinculan a la cuenta que las inició; se excluyen salidas ya pasadas, salvo viajes en curso. Las pruebas HTTP distinguen explícitamente 204 vacío, 200 con viaje y acceso no autorizado.

**Solicitudes recuperables.** `GET /v1/booking-inbox` devuelve hasta 50 solicitudes/respuestas propias. `GET /v1/booking-inbox/:bookingId` permite abrir la solicitud exacta y consultar su estado actual, incluso si fue cancelada, rechazada o venció su disponibilidad. Las consultas comprueban participación y cuenta activa; no se abre acceso directo a tablas ni se añaden migraciones.

La bandeja incluye pendientes del conductor de viajes futuros, y respuestas vigentes del pasajero identificadas por el outbox de los últimos siete días. No depende de que el aviso haya sido entregado: un registro pendiente, fallido o expirado del proveedor no consume la respuesta de la aplicación. Una confirmación antigua ya sustituida por cancelación no vuelve como si siguiera vigente. El historial mantiene el resto de las reservas.

**Presentación.** Se eligió una pantalla dedicada para revisar y responder, un acceso prioritario en Inicio y una hoja animada reutilizando `AnimatedModal` para destacar novedades en Inicio, Viajes o viaje programado. La hoja se puede posponer; no invade chat, formularios ni seguimiento activo. Muestra participante, subida, bajada, ruta, fecha, lugares, aportación y vehículo del conductor para el pasajero. Aceptar/rechazar tienen acciones separadas y bloqueo inmediato contra doble pulsación. Los colores provienen del tema; la animación existente respeta movimiento reducido.

**Sincronización.** Una consulta React Query compartida cada tres segundos en primer plano y una revalidación al reanudar recuperan la verdad del servidor. Se reutilizan invalidaciones de listas/detalles; no se añade WebSocket ni librería. Una red fallida conserva información para lectura, pero deshabilita acciones sobre resúmenes desactualizados. Antes de responder se vuelve a consultar la solicitud y el servidor valida de nuevo bajo bloqueo transaccional. Aceptar nuevamente el mismo estado es idempotente y no consume otro asiento; una cancelación o respuesta incompatible devuelve conflicto.

**Confirmaciones vistas.** Solo identificadores de evento y fechas se guardan en Keychain/Keystore, separados por cuenta/API. La escritura se serializa para no perder reconocimientos concurrentes. Se consideran vistos al pulsar Entendido o abrir el detalle; recibir un push o consultar datos no los consume. Revisar después solo pospone la hoja durante esa sesión. Persistencia por ocho días frente a la ventana remota de siete días; no es sincronización de leídos entre varios teléfonos. Un almacenamiento corrupto impide la alerta automática y conserva la bandeja consultable.

**Push.** Se reutilizan outbox, cifrado de tokens y proveedor FCM. Antes de enviar un evento de reserva se comprueba que su estado siga vigente. El payload incluye `bookingId`; Android incorpora ese UUID en el enlace de las notificaciones de reserva. La app espera sesión y acceso de conductor antes de abrir `BookingRequests`; el detalle vuelve a autorizar la participación. El receptor exige destinatario coincidente, UUID válidos y caducidad. Los avisos de chat/proximidad conservan la apertura de viaje existente.

**Chat.** Se eliminó `inverted`; los mensajes se ordenan cronológicamente y los recientes quedan abajo. La carga de anteriores es explícita en la cabecera y conserva la posición visible. El scroll solo sigue el final cuando el usuario está cerca de él; abrir el teclado mantiene ese criterio. Se conserva alineación por emisor, temas y reintento con el mismo `clientId`. Lecturas/envíos se vinculan al actor; una respuesta tardía al cambiar de conversación/cuenta no borra otro borrador ni reinicia su consulta.

## Validación ejecutada

- API: **195 pruebas en 28 suites** con PostgreSQL temporal aislado, sin suites omitidas; incluye las comprobaciones nuevas de recuperación, autorización, expiración, capacidad e intents obsoletos.
- HTTP E2E: **8 pruebas en 2 suites** aprobadas con controladores/filtro/SQL reales y dobles de Auth/Maps. No acreditan Auth, GPS ni FCM de producción.
- Móvil: batería completa **246 pruebas en 39 suites**; después de los últimos ajustes de reconocimiento/apertura y acceso en Inicio, regresión dirigida **9 pruebas** aprobadas. Tipos y lint aprobaron.
- Web: **56 pruebas en 12 archivos**, incluida preservación de un solo `bookingId` válido y rechazo de parámetros ambiguos en el respaldo Android.
- Google FCM HTTP v1: validación remota **200** con `validate_only=true`, sin entrega de mensajes. Comprueba acceso a la API y validez de la petición; no certifica registro Android, recepción, presentación ni apertura. [Contrato oficial](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send). [Evidencia](booking-fcm-validation-20261020.json).
- Antes de activar flags: **cero viajes en curso, cero dispositivos registrados y cero intents vigentes**. No se generaron viajes o reservas en producción para las pruebas.

Los primeros intentos de E2E/Jest encontraron restricciones del sandbox de puertos/caché. Se ejecutaron fuera de él sin cambiar las comprobaciones. Los errores iniciales de fixtures/formato se corrigieron y las ejecuciones finales aprobaron.

## Publicación y paquete de prueba

- **Railway:** despliegue `0345808e-4574-4930-a27a-601df20ba262` terminado correctamente. La API publicada en `https://krow-api-production.up.railway.app/v1` aprobó **15 comprobaciones HTTP**, incluidas bandeja autenticada, privacidad del detalle y HTTP 204 sin viaje activo. Estas comprobaciones no crearon viajes/reservas ni enviaron notificaciones. [Resultados](booking-interactions-http-20261020.json).
- **Web:** despliegue `dpl_8bkobhFGaaqv2PiV9cf8P3jGbMgQ` promovido al dominio aprobado `https://krow-web-gamma.vercel.app`; **3 comprobaciones públicas** aprobaron: enlace con reserva, asociación Android y callback. La disponibilidad del callback no acredita la configuración de redirects en Supabase Auth. La automatización de navegador está deshabilitada en este entorno; la hidratación y apertura real se mantienen pendientes. [Resultados](booking-links-public-20261020.json).
- **Android:** APK privado **0.6.0-trial**, código 11, en `C:/Users/Novasys/Documents/krow-app-mobile/artifacts/android/krow-0.6.0-trial.apk`. Firma, versión, bundle Hermes y recursos Firebase verificados; no instalado porque ADB no detectó dispositivos. SHA-256: `ADBA4B1F475B830B0CE1D551CD6480AA5C6A452F78C9071B46311CF8246ECB33`.
- **Activación:** push habilitado en la API y en este APK. Cada usuario debe iniciar sesión y pulsar **Perfil → Activar notificaciones**, concediendo el permiso del sistema cuando corresponda. La bandeja continúa recuperándose desde la API sin depender del permiso ni de la entrega push. La validación de FCM sin envío aprobó, pero el registro, recepción y apertura en un teléfono siguen pendientes.

La evidencia conjunta está en [booking-interactions-evidence-20261020.json](booking-interactions-evidence-20261020.json). La compilación usa el certificado existente de pruebas privadas; no constituye una entrega a Play Store.

## Matriz de escenarios

| Escenario | Evidencia del entorno de desarrollo | Aceptación física |
| --- | --- | --- |
| Nueva solicitud recuperada por conductor | SQL de pendientes y prueba del host al inicio normal | Pendiente |
| App reanudada sin push | Revalidación por AppState y consulta compartida | Pendiente |
| Aceptación/rechazo y respuesta al pasajero | Servicio SQL, autorización HTTP y pruebas de aviso/recibos | Pendiente |
| Doble pulsación o aceptación repetida | Bloqueo móvil y prueba de un único descuento de cupo | Pendiente de interfaz física |
| Cancelación/expiración antes de responder | Consulta detalle y rechazo transaccional; prueba móvil no envía aceptación | Pendiente |
| Pérdida y recuperación de conexión | Prueba de refresco fallido, suspensión de acciones y recuperación del estado remoto | Pendiente de modo avión |
| Confirmación no repetida al reabrir | Persistencia protegida simulada, reconocimiento y nuevo montaje | Pendiente con Keystore real |
| Apertura desde notificación | Enlace frío espera login y apunta al booking exacto; build nativo | Pendiente del SO/FCM real |
| Chat cronológico, paginado y sin inversión | FlatList sin inversión y pruebas de orden/reintento | Teclado/scroll físico Android e iOS pendientes |

## Continuación del plan

Estas mejoras avanzan las actividades 2, 3, 4, 7 y 8. También se actualiza la documentación de arquitectura y aceptación de la actividad 9. No se dan las nueve actividades por terminadas.

La siguiente aceptación es instalar el APK privado, iniciar sesión y activar avisos desde Perfil en Android; comprobar permiso concedido/denegado, app abierta, segundo plano y proceso cerrado. El cierre forzado por el usuario impone restricciones del sistema y no debe prometerse recepción garantizada. [Recepción Android](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).

Siguen pendientes del plan general: recurrencia, modelo de invitaciones, recordatorios programados, verificación del redirect de Supabase Auth, mapas/GPS con dos participantes, modo avión, accesibilidad/rendimiento físicos y cierre de evidencias académicas. No se mezclaron esas funciones con las correcciones prioritarias ni se activó el runtime avanzado.

Archivos principales: `pilot.inbox.ts`, `pilot.service.ts`, `pilot.notifications.ts`, `rides.controller.ts` y `notification-providers.ts` en API; `BookingEventsHost`, `BookingRequestsScreen`, `BookingNoticeCard`, `bookingEvents`, `RootNavigator`, `ChatScreen`, `apiClient` y `KrowMessagingService` en móvil; `mobile-links.ts` en web.
