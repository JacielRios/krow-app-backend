# Trazabilidad actual de las nueve actividades

Actualización: 20 de octubre de 2026, después de implementar permisos al abrir, recurrencia finita, invitaciones compartidas y recordatorios. Este registro distingue desarrollo y aceptación; no sustituye pruebas de dispositivo por mocks ni da por completas las nueve actividades.

| Actividad | Estado de cierre | Implementación y evidencia disponible | Qué impide cerrarla |
| --- | --- | --- | --- |
| 1. UX, flujos y arquitectura de navegación | Parcialmente completada | Arquitectura, flujos autenticados por rol, solicitudes, reservas, invitación compartida y enlaces documentados. | Recorrido de aceptación completo y validación de requisitos no funcionales en Android. |
| 2. Estado y estructura móvil | Parcialmente completada | React Query, estado local de formularios, componentes compartidos, invalidación por actor, persistencia protegida y pruebas de cambio de cuenta/concurrencia. | Confirmar aislamiento, restauración y consistencia con almacenamiento y ciclo de vida reales. |
| 3. Navegación y Deep Linking | Parcialmente completada | Stacks autenticados, protección de conductor, enlaces de viaje/reserva/invitación, destino retenido tras login y respaldo HTTPS publicado. | Apertura con el SO Android y callback de Auth guardado; recuperación/confirmación por correo completas. |
| 4. Interfaces y experiencia visual | Parcialmente completada | Pantallas conectadas, estados de interacción, bandeja prioritaria, confirmación animada, chat cronológico y reutilización del tema/componentes. | Aceptación visual con teclado, tamaños de pantalla, temas, movimiento reducido y controles accesibles. |
| 5. Mapas, calendarios y programación | Parcialmente completada | Avenidas/paradas publicadas, búsqueda por destino/fechas, programación futura, lote recurrente con revisión y recuperación; reglas de vigencia/cupo verificadas. | Recorrido GPS/mapas y consistencia de estados con participantes reales; uso nativo de calendarios y lote. |
| 6. Consulta offline, persistencia y sincronización | Parcialmente completada | Consulta protegida de perfil/listas por 24 horas; revalidación, idempotencia y lote retomable por cuenta/API. Operaciones de negocio requieren conexión. | Modo avión, restauración y aislamiento con Keystore real. No se necesita convertir el piloto en escrituras offline automáticas. |
| 7. Push y eventos | Parcialmente completada | Firebase real configurado, outbox/cifrado/proveedor existentes, permiso inicial, registro tras login, destinatario/estado/caducidad y recordatorios de salida. FCM `validate_only` y pruebas de eventos aprobadas. | Registro FCM y recepción/apertura reales en primer plano, segundo plano y proceso cerrado, incluida negativa y revocación de permisos. |
| 8. Rendimiento, accesibilidad y pruebas | Parcialmente completada | Pruebas SQL/HTTP/móviles/web, correcciones de viaje vacío/chat y regresiones de publicación, cancelación, red, doble pulsación y cambio de cuenta. Tipos/lint/build aprobados. | Perfilado y estabilidad físicos, teclado/scroll, accesibilidad y recorrido entre dos participantes. |
| 9. Documentación y entrega | Parcialmente completada | Arquitectura, guías, decisiones elegidas por el usuario, evidencias, APK firmado de prueba y servicios publicados; matriz actual. | Completar evidencias físicas y Auth, resolver hallazgos y firmar la aceptación. El histórico SQL inicial incompleto limita reconstruir toda la base desde cero. |

## Decisiones de alcance confirmadas

- Android primero; iOS no está construido ni certificado.
- Recurrencia: publicar fechas con vista previa/confirmación, hasta cuatro semanas; cada salida se administra por separado.
- Invitaciones: enlaces compartidos; el pasajero solicita y el conductor aprueba. No son invitaciones privadas a una cuenta.
- Offline parcial: lectura segura de datos propios consultados; reservar, publicar, chat y operación del viaje requieren conexión.
- Mantener diseño, React Query y separación React Native/NestJS/Supabase. No se añadieron dependencias ni servicios para esta continuación.

## Aceptación siguiente

| Prueba | Requisito de entorno | Resultado a registrar |
| --- | --- | --- |
| Primer arranque con permiso concedido/denegado | Un Android 13+ con APK 0.7.0; estado del permiso conocido | Diálogo, ausencia de bloqueo, respeto de negativa y registro tras login. |
| Retorno desde Ajustes y cambio de cuenta | Un Android y dos cuentas autorizadas | Registro de la cuenta vigente; ninguna notificación de la cuenta anterior. |
| Enlaces de viaje, reserva e invitación | Un Android; app cerrada, abierta y sin sesión | Destino correcto después de login y consulta del estado actual. |
| Recuperación/confirmación de cuenta | Callback agregado en Supabase y correo de una cuenta de prueba autorizada | Redirección al SO, token válido/caducado y contraseña actualizada. |
| Lote recurrente | Un Android, conductor aprobado, fechas de prueba explícitas | Vista previa, número de viajes, identificadores persistidos y recuperación tras pérdida de red. |
| Solicitud y respuesta por invitación | Dos participantes; para recepción simultánea, dos instalaciones Android | Solicitud pendiente, aprobación/rechazo, cupo único y respuesta al pasajero. |
| Recordatorio y ciclo de vida | Android registrado y viaje de prueba dentro de la ventana | Recepción/apertura; cancelación y viaje iniciado no reciben un aviso obsoleto. |
| GPS, mapas y conectividad | Dos participantes y recorrido controlado | Ubicación, paradas, retraso/red, finalización y pérdida/retorno de conexión. |
| Teclado, accesibilidad y rendimiento | Android con distintos tamaños de fuente, temas y movimiento reducido | Chat legible, scroll estable, controles accesibles, ausencia de bloqueos/cierres y mediciones. |

Registrar para cada prueba: versión/código del APK, modelo, versión Android, cuentas de prueba anonimizadas, red, permiso, pasos, resultado esperado/observado, fecha y evidencia. No introducir credenciales, tokens, datos personales o ubicaciones privadas en el repositorio ni en capturas públicas.

## Fuentes de esta actualización

- [Arquitectura](architecture.md).
- [Permisos, recurrencia, invitaciones y recordatorios](permissions-recurrence-20261020.md).
- [Evidencia conjunta actual](permissions-recurrence-evidence-20261020.json).
- [Solicitudes, confirmaciones y chat: etapa anterior](booking-interactions-20261020.md).

Quedan principalmente aceptación nativa, configuración/recorrido de Auth y cierre de evidencias. No se presenta un porcentaje nuevo como si equivaliera a una auditoría integral repetida o a validación física aprobada.
