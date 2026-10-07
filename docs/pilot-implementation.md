# KROW: implementación local y salida del piloto

Actualizado: 7 de octubre de 2026. La [entrega actual](krow-corrections-20261007.md) incluye origen ITNL, catálogo de avenidas, correcciones del mapa/GPS y teclado, APK 0.2.1 y actualización del backend. Este documento distingue código implementado,
integraciones pendientes y pruebas que todavía no se han realizado. El roadmap
completo no está terminado. El 6 de octubre se aplicaron tres migraciones de
estructura y el grupo privado del backend en Supabase. La API ya está publicada
en Railway; health/readiness, rechazo sin JWT y transporte WebSocket aprobaron.
El LOGIN limitado ya autentica por TLS y Railway devuelve `pilot: ready`, con
piloto/GPS activados. La función temporal autorizada para provisionarlo quedó
retirada con HTTP 410; no se cambió la contraseña de postgres. Las restricciones
finales ya están aplicadas; el cliente actualizado usa la API como escritor de
viajes y para perfiles completos. El APK privado actualizado ya está generado
y verificado. Ver [evidencia de
activación](railway-pilot-activation-20261006.json).

## Resultado implementado

El módulo `apps/api/src/modules/pilot` permite ejecutar el piloto online sin
activar el runtime avanzado. Incluye operaciones de subida, bajada y ausencia,
finalización validada en servidor, actividad filtrada por rol y estado, contexto
de reserva, efectivo con importe congelado, reseñas en el modelo existente,
chat por reserva y seguimiento privado del vehículo.

La aplicación móvil incorpora Inicio/Viajes/Perfil, cuenta con modo independiente
de sus capacidades, pantallas programadas/activas/históricas, chat y ajustes.
Los tokens, controles y estados compartidos se consolidan en `ui-v2`. Se agregan
recuperación de contraseña, enlaces de autenticación y almacenamiento de sesión
en Keychain/Keystore, incluyendo migración del almacenamiento anterior.

Búsqueda/reserva se organiza en recorrido, paradas y resultados, con revisión
antes de enviar. Publicación incorpora errores por campo, salida protegida y
recuperación de conflictos. Las favoritas priorizan «Usar» y admiten cupo y
precio opcionales sin vehículo. Solicitudes se agrupan por parada de subida.

El conductor ve el recorrido, próxima parada y pasajeros por subir/bajar; el
pasajero ve su encuentro y descenso. Android dispone de un servicio foreground
de captura y envío GPS con notificación persistente y cola local cifrada. Este
código nativo aprobó `:app:compileDebugKotlin` y después `assembleTrial` el 6 de
octubre. El APK privado contiene ARM64/ARMv7 y bundle Hermes; firma y manifiesto
aprobaron. Todavía requiere instalación y pruebas físicas antes del piloto con usuarios.

## Estado frente al roadmap

**Implementado** significa que existe código y que las comprobaciones locales
indicadas abajo aprobaron. No equivale a certificación en dispositivos ni a
despliegue. **Parcial** identifica trabajo pendiente dentro de la misma tarea.
**Externo** requiere datos, credenciales o decisiones del equipo. **Posterior**
mantiene el alcance de las fases posteriores del roadmap.

| ID | Estado | Entrega y pendiente concreto |
| --- | --- | --- |
| C01 | Parcial | Auditoría del esquema real, 21 migraciones de mayo recuperadas del ledger y cinco versiones de septiembre reconciliadas. Verificación de integridad preparada en CI. Falta el esquema inicial anterior a mayo, reproducción desde cero y restauración ensayada. |
| C02 | Parcial | RPC de escritura limitadas al rol privado, actor preservado, permisos por propiedad, bloqueo de cuentas inactivas y cuotas de mapas. Permisos reales aplicados y verificados; falta ensayo integral en staging y coordinación operativa con Admin externo. |
| C03 | Implementado | Inicio conserva reservas confirmadas; subida/bajada/ausencia explícitas; cierre bloqueado mientras haya pendientes; historial real de completados. |
| C04 | Implementado | Contexto de reserva, coordenadas, orden de paradas, vehículo, importe congelado y estados reales. Importes de reservas anteriores se reconstruyen del precio disponible; no existe fuente histórica para recuperar modificaciones pasadas. |
| C05 | Parcial | Recuperación, reenvío, edición, restauración recuperable y sesión segura. Falta dominio de enlaces verificado, configuración Auth y ensayo de correo real. |
| C06 | Parcial | Zona ITNL definida; 14 referencias verificadas sobre Eloy Cavazos, Pablo Livas y Reynosa registradas, además de los tres puntos existentes. Falta comprobar en campo dónde detenerse, aprobar conductores/unidades y completar el contrato operativo con Administración. |
| C07 | Implementado | Preferencia por cuenta, capacidades del servidor y consultas por contexto conductor/pasajero. |
| C08 | Parcial | CI preparado, pruebas SQL del piloto y contratos HTTP. Falta ejecutar CI y completar baseline para probar el esquema integral. |
| D01 | Parcial | Estados comunes implementados; faltan capturas actuales y matriz visual completa en dispositivo. |
| D02 | Parcial | Tokens semánticos, tipografía, espaciado, radios y temas consolidados. Falta revisión visual integral de contraste. |
| D03 | Parcial | Adaptadores legacy y controles compartidos actualizados; headers y tarjetas nuevas. Falta migrar todos los formularios y selectores legacy. |
| D04 | Parcial | Estados de carga/error/reintento y feedback accesible en pantallas piloto; errores 5xx saneados. Falta catálogo uniforme de códigos y textos en toda la API/app. |
| D05 | Parcial | Controles de 48, safe areas y adopción de movimiento reducido. Falta auditoría TalkBack, foco y texto ampliado por pantalla. |
| D06 | Parcial | Cache por cuenta/modo, actualización en foco, contenido conservado y mapa activo estable. Falta perfilado release en Android de referencia. |
| U01 | Implementado | Tres pestañas reales y stacks de detalle, habilitados con el flag piloto. |
| U02 | Parcial | Login/registro/recuperación mejorados, autofill, labels y contraseña visible; espera fija retirada. Falta validación visual de teclado y primer error en todos los formularios. |
| U03 | Parcial | Home operativo con viaje activo y siguiente acción; salida trasladada a Perfil. Falta QA visual y de primer uso. |
| U04 | Parcial | Búsqueda de tres pasos, resumen visible, revisión de reserva y reintentos conservando resultados; envío protegido ante doble toque. Falta QA visual y validación del flujo real en staging. |
| U05 | Parcial | Mapa/lista sincronizados, marcadores de lugar solicitado y parada real diferenciados, numeración de publicación y encuentro/descenso propios. Falta QA físico de selección y mapa. |
| U06 | Parcial | Wizard con errores por campo, salida protegida y recuperación de conflictos; rutas calculadas por backend. Falta ensayo físico de teclado/texto y persistencia de borradores entre reinicios. |
| U07 | Parcial | Favorita sin vehículo con valores opcionales y acción principal «Usar»; editar/eliminar secundarios. Falta QA visual y aplicar permisos en staging. |
| U08 | Implementado | Grupos en servidor, paginación, orden de próximos/historial y estados por rol. La paginación de actividad usa offset; cursores estables quedan para optimización. |
| U09 | Parcial | Solicitudes agrupadas por parada, progreso accesible de reserva, pendientes explicados y comienzo bloqueado hasta resolverlas. Falta QA visual y validación de primer uso; no se inventan fechas de eventos. |
| U10 | Parcial | Perfil, edición, tema, modo, estado conductor, salida y recuperación ante error. Soporte y privacidad requieren configuración real. |
| U11 | Parcial | Moneda con centavos, fechas y estados compartidos; transiciones reducidas compatibles. Falta adopción total en pantallas legacy. |
| G01 | Implementado | Tracking independiente y almacenamiento privado de sesión/última posición. |
| G02 | Implementado | Credencial limitada, secuencia/fecha monotónicas, Socket y REST autorizados; máximo 512 conexiones y tres por cuenta, revocación al terminar. Falta prueba de carga y distribución multiinstancia posterior. |
| G03 | Parcial | Servicio foreground Android y cola cifrada de diez minutos; compilación Kotlin aprobada. Falta empaquetar/instalar el APK y medir continuidad/batería en dispositivo. |
| G04 | Parcial | Recorrido Google por paradas pendientes; origen GPS preciso si está disponible; fallback a ruta publicada explícito. ETA aproximada conservadora, sin tráfico ni recálculo automático por desvío. Falta calibración física. |
| G05 | Parcial | Próxima parada, pasajeros y confirmación manual; evento de proximidad en outbox. Falta ensayo de avisos GPS y FCM reales. |
| G06 | Parcial | Mapa a pantalla completa que permanece al expandir el panel, próxima parada y nombres por subir/bajar visibles, vehículo animado y centrado. Falta validar legibilidad e interacción física. |
| G07 | Parcial | Vehículo, ruta, encuentro, descenso, ETA y chat propios. Falta prueba física entre dos teléfonos. |
| G08 | Parcial | Antigüedad, señal atrasada, ETA invalidada, revocación y borrado de posición. Falta ensayo de permisos/red/GPS/reinicio real. |
| G09 | Externo | Pendiente recorrido físico de treinta minutos, incluido bloqueo de pantalla. |
| P01 | Implementado | Chat paginado con cursor temporal preciso, envío idempotente, reintento y lectura histórica; escritura limitada a reserva elegible. |
| P02 | Implementado | Importe congelado y efectivo pendiente/cobrado/anulado; el pago no bloquea el cierre. |
| P03 | Implementado | Reseña opcional sin duplicados, integrada en `public.ride_reviews` y promedios existentes. |
| P04 | Implementado | Resúmenes y cancelados con datos reales del actor, paradas, efectivo y reseña. |
| P05 | Parcial | Dispositivos privados, tokens cifrados, outbox, reintentos y protección de cambio de cuenta. Falta Firebase y prueba de entrega/enlace real. |
| P06 | Externo | Ayuda configurable y explicación GPS incorporadas. Faltan responsable, contacto, aviso y plazos aprobados; no hay purga automática de chat/reseñas. |
| P07 | Parcial | Cierre deshabilitado por defecto; si se habilita, bloquea acceso y registra solicitud. Borrado/anonimización quedan pendientes de política y worker. No presentar esta operación como borrado completo. |
| Q01 | Parcial | Release exige firma productiva y clave Android propia; versión y CI nativo preparados. Falta keystore, build firmado e instalación. |
| Q02 | Pendiente | No se ha creado staging, ni ejecutado backup/restauración/rollback. |
| Q03 | Parcial | Readiness del rol/esquema privado, request IDs y fallos saneados. Faltan métricas GPS/push, alertas y comprobación completa de dependencias. |
| Q04 | Parcial | E2E HTTP y SQL del ciclo piloto; RPC real de solicitud, privacidad e idempotencia. Tres pruebas de concurrencia con LOGIN privado preparadas para PostgreSQL real, aún sin ejecutar localmente. Faltan publicación/búsqueda reales. |
| Q05 | Pendiente | Falta matriz visual, TalkBack, temas/texto grande, teclado y perfilado release físico. |
| Q06 | Externo | Falta piloto supervisado con al menos cinco estudiantes. |
| Q07 | Parcial | Este registro y guía Android documentan contratos/configuración/validación; faltan procedimientos operativos ensayados y soporte real. |
| E01 | Posterior | iOS: implementación nativa equivalente, firma/APNs y dispositivos Apple. |
| E02 | Posterior | Filtros ampliados y acompañantes. |
| E03 | Posterior | Solicitud de conductor y documentos privados integrados con Admin externo. |
| E04 | Posterior | Tickets/reportes y revisión administrativa. |
| E05 | Parcial | Índices de actividad/reseñas y caches limitadas añadidos; falta optimización guiada por métricas y retirada legacy. |
| L01 | Posterior | Consolidar runtime v2, disponibilidad por tramo y único escritor. |
| L02 | Posterior | Reconciliación de proveedores/geometrías y calibración de ETA avanzada. |
| L03 | Posterior | Giro a giro, voz, maniobras y recálculo asistido. |
| L04 | Posterior | Navegación offline certificada en Android/iOS. |
| L05 | Posterior | Incidentes, responsables y simulacros operativos con Admin. |
| L06 | Posterior | Distribución compartida, carga prolongada y failover. |
| L07 | Posterior | Captación/contacto/empresas; pagos electrónicos como alcance separado. |

## Contratos añadidos

Todos los caminos HTTP incluyen `/v1`. Salvo el envío GPS con credencial
limitada, requieren `Authorization: Bearer <access_token>` y participación
verificada por servidor.

| Método y camino | Función |
| --- | --- |
| `GET /activity?context=driver\|passenger&group=upcoming\|active\|history&offset=0&limit=30` | Lista filtrada antes de paginar; límite máximo 50. |
| `POST /rides/:rideId/stops/:bookingId/attend` | `{action: "board"\|"dropoff"\|"no-show"}`. Solo conductor propietario. |
| `GET /rides/:rideId/history` | Contexto y reservas visibles para el actor, precio/efectivo/reseña reales. |
| `GET /rides/:rideId/tracking` | Snapshot privado, antigüedad, ruta, próxima acción y ETA aproximada o nula. |
| `POST /rides/:rideId/tracking/sessions` | `{deviceId: UUID}`; sesión limitada a viaje/dispositivo, duración seis horas. |
| `DELETE /rides/:rideId/tracking/sessions` | Revocar GPS como conductor. |
| `POST /rides/:rideId/tracking/locations` | `{sessionId, uploadToken, samples}`; 1–100 muestras con secuencia y fecha. Credencial solo de escritura GPS. |
| `POST /rides/:rideId/tracking/locations/close` | Revocación idempotente con esa credencial; no puede cerrar una sesión posterior. |
| `GET /bookings/:bookingId/messages?cursor=...` | Historial por cursor opaco y máximo 40 mensajes. |
| `POST /bookings/:bookingId/messages` | `{clientId: UUID, body}`; máximo 2000 caracteres. |
| `GET /bookings/:bookingId/cash` | Importe y estado de efectivo. |
| `POST /bookings/:bookingId/cash/collect` | Confirmación idempotente del conductor. |
| `POST /bookings/:bookingId/review` | `{stars: 1..5, comment?: string}`; reserva completada y autor elegible. |
| `POST /devices`, `DELETE /devices/:deviceId` | Registro y retiro de dispositivo FCM del actor. |
| `POST /me/closure` | Flag separado; devuelve `access_closed` y `dataProcessing: pending_policy`. |
| `GET /health/ready` | Disponibilidad del esquema/rol piloto; no certifica Google, Auth ni FCM. |

Socket.IO usa namespace `/v1/tracking`, transporte websocket y auth
`{token, rideId}`. Publica `tracking` cada dos segundos, revalidando actor y
participación. Ante pérdida de socket, la app usa REST cada cinco segundos.
Este piloto está diseñado para **una instancia** de API.

Las rutas fallidas muestran la geometría publicada con un mensaje explícito y
sin ETA. Se reutiliza ese fallback durante quince segundos antes de reintentar;
al recuperarse el proveedor desaparece el error. Los lotes GPS reconocen muestras
antiguas válidas sin retroceder la posición actual ni bloquear la cola local.

## Activación coordinada en staging

1. Completar C01 antes de un `db push`: revisar la auditoría
   `schema-audit-20261006.json`, los ledgers exportados y el esquema inicial
   anterior al 2 de mayo, todavía ausente en Git. Las 21 migraciones de mayo
   se recuperaron con sus versiones y SQL originales, sin reaplicarlas.
   La auditoría contiene metadatos, no una baseline
   ejecutable. `apps/api/test/pilot-baseline.sql` es exclusivamente una fixture
   sintética; **no es una migración de producción**.
2. Verificar backup y restauración de staging. Revisar con Admin externo sus
   rutas de alta manual: los permisos nuevos impiden que usuarios móviles
   aprueben conductores, creen vehículos o reescriban estados/rating directamente.
3. Preparar una versión de API compatible con el piloto y un LOGIN privado
   administrado fuera del repositorio. Nunca conectar con propietario, superuser,
   `BYPASSRLS` ni credencial `service_role` de Supabase. El LOGIN debe pertenecer
   al grupo `krow_pilot_service` con los privilegios de `scripts/pilot-role.sql`.
4. La estructura se aplicó con versiones `20261006221452`, `20261006221521`
   y `20261006221527`, conservando los privilegios legacy. El usuario aprobó
   específicamente el grupo privado, aplicado como `20261006222624_pilot_private_api_role.sql`.
   Preparar el LOGIN privado y una API piloto operativa. En ventana coordinada, aplicar
   `20261007002518_pilot_profile_privacy.sql` y
   `20261007002528_pilot_api_cutover.sql`. Estos dos pasos restringen perfiles y
   escritura directa; `/me`, Auth y participantes deben usar la API privada.
   Las versiones de septiembre se reconciliaron con el ledger remoto; no se
   deben volver a ejecutar con los nombres antiguos.
5. Configurar `RIDE_PILOT_ENABLED=true`, `PILOT_DATABASE_URL` del LOGIN privado,
   CA válida en producción, Auth y Google REST. Mantener runtime avanzado apagado.
   Activar `RIDE_TRACKING_ENABLED=true` junto con el build Android validado.
   Configurar clave Google REST solo en API y restringir cuotas/proveedor.
6. Comprobar `/v1/health/ready`, permisos, rutas, reservas y cierre con cuentas
   sintéticas controladas. Asegurar que escritura directa Auth/PostgREST sea
   rechazada mientras API conserva `auth.uid()` y propiedad.
7. Activar flags móviles equivalentes; consultar la guía Android del repositorio
   móvil. FCM y cierre de cuenta usan flags separados; mantenerlos apagados hasta
   disponer de sus requisitos reales.

No desactivar simplemente el flag piloto después de revocar las RPC legacy:
los clientes legacy no podrían escribir. Un rollback debe conservar una API
compatible con estos permisos o aplicar una reversión revisada y ensayada.
La estructura y el grupo privado ya están aplicados. El grupo fue rechazado
inicialmente por la revisión automática; el usuario autorizó sus privilegios
de forma específica y el reintento aprobó. No activar flags piloto ni revocar
los permisos legacy hasta completar el LOGIN y la configuración API.

## Configuración y retención

`apps/api/.env.example` enumera las variables sin secretos. Push requiere
`PILOT_PUSH_ENABLED`, credenciales FCM y `PILOT_PUSH_ENCRYPTION_KEY` de 32 bytes.
El cierre exige flag, soporte y aviso configurados, pero también debe existir
política aprobada y proceso de datos antes de ofrecerse a usuarios reales.

El servidor conserva la última posición GPS y la elimina al terminar; no guarda
trayectoria histórica. La cola Android cifrada conserva hasta diez minutos de
interrupción y se borra al detener el servicio. Credenciales expiran a seis horas;
tras expiración/force-stop/reinicio se debe abrir la app para reanudar captura.
No se garantiza navegación offline ni reinicio automático en boot.

Chat, reseñas y solicitudes de cierre **todavía no tienen purga automática**.
La retención aprobada no ha sido proporcionada. Soporte/privacidad permanecen
sin valores inventados. La protección de contraseñas filtradas reportada por
Auth tampoco se ha activado remotamente; revisar su configuración con el equipo.

## Verificación local y límites

Comprobaciones realizadas en esta entrega:

- TypeScript backend/web y móvil; lint API y móvil.
- Compilación de producción API y web.
- Backend: 83 pruebas aprobadas; diez del runtime avanzado y tres de concurrencia
  piloto omitidas al no tener `TEST_RUNTIME_DATABASE_URL` / `TEST_PILOT_DATABASE_URL`
  locales. El piloto usa PGlite aislado con migraciones, RLS, permisos de columna,
  RPC real de solicitud y triggers heredados auditados.
- E2E HTTP: cuatro pruebas aprobadas (health y tres del piloto). Auth y proveedor
  de rutas se sustituyen en estas pruebas; el viaje ya está sembrado. No prueban
  correos, Firebase, Google real ni publicación/búsqueda móvil integral.
- Móvil: 111 pruebas aprobadas, incluidas sesión segura, recuperación PKCE,
  publicación/reserva, selección de la nueva reserva tras cancelar, chat,
  mapa, próxima bajada, permisos GPS, cambio de cuenta y doble toque.
- Importación de paradas: seis pruebas aprobadas.
- Integridad del ledger: 26 migraciones locales comparadas con el SQL exportado;
  se normalizan únicamente saltos de línea y espacios finales del archivo.

El bundle JavaScript Android de producción se generó con Metro. `npm ci --dry-run`
aprobó para ambos repositorios. Los workflows de GitHub Actions están preparados,
pero no se han ejecutado desde esta entrega. Android no pudo compilar localmente:
Gradle 9 rechazó Java 8; el equipo carece del SDK Android. El workflow instala
Java 21, SDK 36 y NDK antes de compilar Kotlin.
No se han certificado latencia GPS p95, reconexión, batería, accesibilidad,
capturas actuales, release firmado ni prueba de cinco estudiantes.

## Revisión técnica y segunda pasada

Se revisaron los contratos HTTP, DTO, servicios, guard, migraciones, políticas
remotas, permisos de columna, listeners, reintentos y navegación. Se corrigieron
carreras de sesión, publicación, chat, captura GPS y registro FCM; selección de
reservas tras cancelar; errores de validación que provocaban 500; conductor o
vehículo sin autorización al comenzar y viajes simultáneos del mismo conductor.
El orden de instantáneas REST/Socket usa `observedAt` del servidor para impedir
que la próxima parada, ruta o posición retrocedan por una respuesta demorada.
Salir durante una petición ya no abre otra pantalla al recibir su respuesta.
Salir mientras se solicitan permisos cancela el inicio todavía no enviado;
el cierre del GPS por viaje solo detiene su sesión, sin afectar un viaje nuevo.

La auditoría inicial fue exclusivamente de metadatos; posteriormente el usuario
autorizó la actualización y confirmó que la API se ejecuta solo localmente.
No se leyeron registros personales. `pilot-security-review-20261006.json`
registra permisos de tabla excesivos y el esquema piloto todavía ausente.
La corrección local se probó con roles reales dentro de PGlite: lectura de
email/identificadores académicos, TRUNCATE y autoaprobación fueron rechazados;
las operaciones del rol privado y `/me` siguieron funcionando.

### SQL aplicado y pendiente, en orden

| Orden | Archivo local | Estado y efecto |
| --- | --- | --- |
| 1 | [pilot_online.sql](../supabase/migrations/20261006221452_pilot_online.sql) | **Aplicado.** Sesiones/última posición, importes comprometidos, chat y reseñas. |
| 2 | [pilot_notifications.sql](../supabase/migrations/20261006221521_pilot_notifications.sql) | **Aplicado.** Dispositivos cifrados, outbox y triggers de avisos. |
| 3 | [pilot_lifecycle_guardrails.sql](../supabase/migrations/20261006221527_pilot_lifecycle_guardrails.sql) | **Aplicado.** Estados explícitos, índices y solicitud de cierre. |
| 4 | [pilot_private_api_role.sql](../supabase/migrations/20261006222624_pilot_private_api_role.sql) | **Aplicado tras aprobación específica del usuario.** Grupo NOLOGIN del backend. |
| 5 | [pilot_runtime_login_role.sql](../supabase/migrations/20261006231801_pilot_runtime_login_role.sql) | **Aplicado.** Rol separado limitado, todavía NOLOGIN y sin contraseña. Hereda únicamente el grupo privado; no tiene ADMIN ni SET. |
| 6 | [pilot_profile_privacy.sql](../supabase/migrations/20261007002518_pilot_profile_privacy.sql) | **Aplicada.** Restricción SELECT de perfiles y TRUNCATE/REFERENCES/TRIGGER; lectura privada API conservada. |
| 7 | [pilot_api_cutover.sql](../supabase/migrations/20261007002528_pilot_api_cutover.sql) | **Aplicada.** API como escritor de viajes; RPC/DML directos del cliente revocados y readiness volvió a aprobar. |

Las cinco primeras migraciones ya están aplicadas en `krow-backend`. Las dos
últimas quedan pendientes del servicio operativo. El grupo privado conserva
lectura entre cuentas, políticas `USING(true)` y actualización sensible de
`rating` e `is_active`, autorizadas específicamente por el usuario. El backend
debe validar identidad y propiedad antes de cada operación. Mantener coordinación con Admin y la
configuración API descritas arriba. La API no debe usar
credenciales propietarias ni `service_role`; readiness comprueba también los
nuevos permisos de perfil para detectar un LOGIN configurado con un script viejo.

Verificación remota: las ocho tablas privadas tienen RLS y no conceden acceso a
`anon` ni `authenticated`; las 33 reservas tienen precio conservado sin diferencias.
Los 11 usuarios, 45 viajes, 33 reservas y cuatro reseñas originales, incluido el
viaje en curso y los tres confirmados, mantuvieron cantidades y estados.
`migration-ledger-20261006.json` conserva versiones/SQL reales y la comprobación
local cubre 29 migraciones. El snapshot anterior contiene metadatos y cantidades,
**no un respaldo completo de datos**; no se ensayó una restauración.

### Dependencias y límites restantes

Se actualizó Next.js a 16.3.6 y transitivas compatibles, corrigiendo los avisos
de producción del monorepo API/web. `npm audit --omit=dev` devuelve cero avisos
allí. En móvil se actualizaron CLI 20.2.0 y transitivas compatibles; se fijó
Reanimated 4.6.0 y la familia Worklets 0.12 para evitar resolver versiones
incompatibles con React Native 0.84. No se usó `--force` ni `--legacy-peer-deps`.

Persisten 34 avisos agregados en `npm audit --omit=dev` móvil, 29 altos y cinco
moderados, sin críticos. Se originan en herramientas Metro/CLI/Jest y sus
parsers de imágenes, patrones y formato; no son 34 fallos independientes ni
demuestran explotación del APK. Requieren actualización compatible del toolchain
y ensayo nativo; no exponer Metro/devtools ni procesar archivos de proyecto no
confiables. El audit completo del monorepo también conserva avisos en herramientas
de desarrollo. No se declara la revisión de dependencias totalmente resuelta.

Supabase continúa con las RPC SECURITY DEFINER advertidas y protección de
contraseñas filtradas deshabilitada. Revisar ambos después de aplicar permisos;
no cambiar funciones a SECURITY INVOKER automáticamente porque rompería la
autorización que realiza el backend. PostgreSQL remoto es 17.6: revisar la
actualización de seguridad ofrecida por el servicio en una ventana ensayada.

Los componentes de finalización antiguos todavía contienen datos de demostración
con `KROW_PILOT_ENABLED=false`. En piloto las rutas usan `HistoryScreen` y datos
reales. El TODO de extraer el bloque de conductor es deuda de refactor, no una
función del piloto faltante. Las fixtures sintéticas y mocks de Auth/Google
permanecen limitados a pruebas; no sustituyen staging ni pruebas físicas.

El mapa de estado por tarea al inicio de este documento sigue vigente: el plan
completo está parcialmente implementado. Faltan baseline, staging/restauración,
instalación física y release con firma productiva, QA visual/accesibilidad, correos/FCM reales,
purga de datos y condiciones externas del piloto. iOS, giro a giro, voz y offline
permanecen posteriores.

## Orden inmediato recomendado

1. Resolver baseline/staging y coordinación de permisos con Admin (C01/C02/Q02).
2. Instalar el APK privado ya generado y preparar la firma del release productivo (G03/Q01).
3. Probar conductor/pasajero en dos teléfonos y recorrido GPS de treinta minutos
   con pantalla bloqueada; corregir fallos antes de ampliar funcionalidades.
4. Validar visualmente búsqueda, selección de paradas, publicación, favoritas y
   solicitudes; completar borradores y QA TalkBack (U04–U09/Q05).
5. Proporcionar catálogo, soporte y políticas; probar Auth/FCM con infraestructura
   real, completar purga/anonimización y concurrencia (C06/P05–P07/Q04).
6. Ejecutar piloto supervisado y medir facilidad de uso; después abordar iOS,
   filtros ampliados y runtime avanzado. Giro a giro, voz, offline y escala
   permanecen en sus fases posteriores.
