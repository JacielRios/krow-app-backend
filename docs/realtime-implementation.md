# Real-time rides implementation and release gates

## Estado real de la implementación local

El plan completo **todavía no está terminado ni habilitado en producción**.
`RIDE_RUNTIME_ENABLED` y `KROW_RUNTIME_ENABLED` permanecen desactivados por defecto.
Los cambios existentes del catálogo, búsqueda y presentación se conservaron.

| Área | Implementado | Pendiente antes de activar |
| --- | --- | --- |
| Transacciones | API v2, capacidad por tramo, visitas ordenadas, idempotencia, versiones, auditoría y outbox | Ensayar sobre una copia íntegra del esquema remoto y reconciliar su historial de migraciones |
| Seguimiento | Socket.IO, lotes HTTPS, secuencias, rechazo de saltos, Kafka, Redis, revocación y distribución con cola acotada | Medición real, observabilidad OpenTelemetry y pruebas de fallos con los servicios desplegados |
| Geoespacial | Adaptador Mapbox, ETA por parada, avisos de proximidad y trabajador de desvíos/tráfico | Map matching con continuidad y ambigüedad, calibración de ETA, tiempos de servicio, explotación de cierres/incidentes y semáforos de prueba |
| Aplicación | Pantalla v2, mapa Mapbox, cola cifrada de acciones operativas, instantánea cifrada, conflictos explícitos y enlaces autorizados | Búsqueda con disponibilidad por tramo; completar compatibilidad de todas las pantallas de reservas |
| Navegación offline | Módulos Kotlin/Swift con descarga de mapa y red vial, navegación provisional hacia la próxima parada, voz, captura nativa y cola cifrada; APK y prueba de persistencia en emulador Android pasaron | Validar recálculo con Mapbox en modo avión, compilar iOS y reconciliar exactamente la ruta nativa compartida; no certificado en carretera |
| Notificaciones | Proveedores FCM/APNs, cifrado de tokens, intentos durables, caducidad, registro nativo Android/iOS, acción Ver viaje | Firma/capacidades iOS, renovación continua de tokens, recibos del dispositivo, acciones chat/llamada, pruebas push reales y pantalla bloqueada |
| Seguridad operativa | Incidentes idempotentes, asignación, auditoría, trabajo independiente de escalamiento, PagerDuty y SMS | Integración completa de la herramienta de guardia, escalamiento por voz, simulacro y guardia 24/7 contratada |
| Infraestructura | Redis/Kafka locales ejecutados, carga de 10.000 eventos, reinicio de contenedores y reconstrucción; carga y restauración PostgreSQL verificadas | IaC AWS/MSK/ECS/WAF/secretos, despliegue multizona, cuotas, PITR/failover regional y prueba de 24 horas |

## Verificación local

### Ampliación y depuración del 30 de septiembre de 2026 (solo entornos locales)

`scripts/runtime-local-validation.mjs` creó bases temporales aisladas, aplicó la
migración sobre el fixture estructural, ejecutó el servicio transaccional real y
las eliminó al finalizar. Evidencia en `artifacts/runtime-local/report.json`:

- 10.000 solicitudes, 50 concurrentes: 881,16 operaciones/s, p95 86,06 ms,
  p99 126,87 ms, sin errores. Es una carga corta de PostgreSQL/servicio, **no** del
  trayecto HTTP/WebSocket ni una certificación para 10.000 conductores.
- Veinte repeticiones simultáneas produjeron una sola reserva; 50 viajes
  rechazaron el tercer asiento después de confirmar los dos disponibles.
- Terminación real de una conexión dentro de una transacción: rollback verificado
  y lectura posterior del viaje correcta.
- `pg_dump`/`pg_restore` a una segunda base: conteos y hash de todas las filas
  coincidentes; restauración más verificación 980 ms en este conjunto pequeño.
  No es PITR ni prueba de recuperación regional.
- `scripts/runtime-brokers-validation.mjs --restart-brokers` **pasó** con Redis
  7.4.2 y Kafka 3.9.0 reales: 10.000 eventos persistidos, p95 de acuse por lote
  de 100 de 14,77 ms, reinicio de ambos contenedores en 13,085 s y reconstrucción
  de la proyección eliminada en 4,584 s. También comprobó que las conexiones y
  la suscripción de la clase real `RuntimeStreams` se recuperan. Los duplicados
  y las secuencias antiguas no retrocedieron el estado. Evidencia en
  `artifacts/runtime-local/brokers-report.json`. No certifica el flujo completo
  HTTP/WebSocket, 50.000 conexiones ni un failover multizona.
- Se corrigió el volumen Kafka para usar `/var/lib/kafka/data`, propiedad del
  usuario de la imagen. Docker arrancó tras preservar sus carpetas de sockets
  temporales dañados y recrearlas. Los respaldos están en
  `%LOCALAPPDATA%/Docker/run.krow-backup-20260930`,
  `%LOCALAPPDATA%/Docker/run.krow-backup-20260930-2` y
  `%LOCALAPPDATA%/docker-secrets-engine.krow-backup-20260930-2`.
  Contenían exclusivamente sockets de cero bytes; no se modificaron secretos,
  imágenes existentes, configuración ni volúmenes del usuario.
- Backend: 40 pruebas en 12 suites. Se corrigieron espera ilimitada de Redis,
  reutilización de conexión PostgreSQL rota y suscripción sin recuperación. La
  reconexión de pub/sub solicita una instantánea porque ese canal no ofrece replay.
- Android: APK generado y prueba instrumentada de cifrado, reapertura y acuses
  ejecutada en Pixel 6 API 34. Móvil: 20 pruebas en 8 suites. iOS: fuentes y
  dependencias preparadas; su validación se pospuso por indicación del usuario.

Para repetir, compilar primero la API; configurar `TEST_RUNTIME_DATABASE_URL`
con una base administradora **local** (el script rechaza hosts remotos),
`KROW_TEST_OPERATIONS=10000` y `KROW_TEST_CONCURRENCY=50`, y ejecutar
`node scripts/runtime-local-validation.mjs`. No usarlo contra datos reales.
Para brokers: iniciar `infra/runtime/compose.yaml` y ejecutar
`node scripts/runtime-brokers-validation.mjs --restart-brokers`; usa exclusivamente los puertos
locales 56379/59092 y limpia únicamente tópicos, grupos y claves de su propia prueba.
Verifica las etiquetas de Docker antes de reiniciar los contenedores del ensayo.

### Validación base de la intervención anterior

- API: 38 pruebas pasaron, incluyendo 9 casos de integración transaccional en
  PostgreSQL 16.13 aislado. El entorno remoto usa PostgreSQL 17; la réplica local es
  estructural y no sustituye la prueba con todos sus triggers, RPC y políticas.
- Móvil: 13 pruebas pasaron, incluyendo orden de acciones offline y enlaces.
- TypeScript de API y móvil pasó; la API compiló con Nest.
- Android: `:app:compileDebugKotlin` pasó con Mapbox y el módulo nativo FCM.
  Esto verifica compilación, no instalación, entrega push ni comportamiento en carretera.
- iOS: se añadieron fuentes Swift/Objective-C y enlaces al proyecto; no compilado
  en esta máquina Windows. Validar con Xcode/macOS y un dispositivo físico.
- No se enviaron avisos reales, no se desplegó infraestructura y no se aplicó la
  migración remota. Redis/Kafka y las cuotas a escala no se han verificado en vivo.

## Ejecución y configuración

1. Conservar el esquema `krow_runtime` fuera de los esquemas expuestos por PostgREST.
   Preparar la migración `20260928170611_ride_runtime_v2.sql` y después
   `scripts/runtime-role.sql` con un propietario de la base. El rol creado es
   `NOLOGIN`; asignarlo únicamente a un login de backend administrado mediante
   secretos. No usar `postgres` ni entregar ese login al cliente móvil.
2. El entorno local de brokers se define en `infra/runtime/compose.yaml`;
   requiere Docker operativo. Redis usa `127.0.0.1:56379`, Kafka
   `127.0.0.1:59092`. Es un entorno de pruebas de un nodo, no un despliegue multizona.
3. `node scripts/runtime-topics.mjs` crea tópicos ausentes con 64 particiones;
   en producción requiere tres réplicas, dos ISR y TLS/SCRAM. Un cambio de
   particiones existente requiere revisión para conservar el orden por viaje.
4. API y trabajador usan las variables de `apps/api/.env.example`. Tras compilar,
   iniciar el trabajador con `node apps/api/dist/runtime-worker.js`; verificar la
   ruta de salida al cambiar la configuración de Nest. La API mantiene `/v1` y
   publica los contratos nuevos bajo `/v2`.
5. Sincronizar contratos con `node scripts/runtime-contracts.mjs --write` y
   verificar divergencias con `node scripts/runtime-contracts.mjs` en CI.
6. Android recibe la configuración pública Firebase mediante variables de
   compilación `KROW_FIREBASE_APP_ID`, `KROW_FIREBASE_API_KEY`,
   `KROW_FIREBASE_PROJECT_ID`, `KROW_FIREBASE_SENDER_ID` y `KROW_LINK_ORIGIN`.
   El origen debe coincidir con el configurado en JS. Las claves privadas FCM/APNs
   permanecen en el servidor. Sin configuración, registrar notificaciones falla
   de forma explícita; no se simula recepción.
7. Publicar `assetlinks.json` y `apple-app-site-association` en el dominio propio,
   con identidades y certificados de firma reales. En iOS usar como referencia
   `KrowRuntime.entitlements.example`, configurar Push Notifications y Associated
   Domains con el equipo de Apple, y probar apertura en frío. No se ha inventado
   ningún dominio ni identidad de firma.

Referencias de integración verificadas: [Mapbox Android](https://docs.mapbox.com/android/navigation/guides/install/),
[regiones offline](https://docs.mapbox.com/android/navigation/guides/advanced/offline/),
[Firebase Android](https://firebase.google.com/support/release-notes/android) y
[acciones iOS](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types).

## Baseline verified on 2026-09-28

Read-only inspection of Supabase project `yyjbqzsokxpzhevpanyq` confirmed PostgreSQL
17, `rides`, `bookings`, `ride_stops`, existing RLS and catalog validation triggers.
`ride_route_versions` is not present remotely. Legacy `complete_ride` force-completes
bookings; legacy acceptance consumes capacity across the whole ride. Existing
September 26 migrations have different timestamps remotely and locally. Do not
push the entire migration directory or replay those migrations blindly.

The new runtime is opt-in per ride. Existing/active rides retain their provider
and legacy APIs. Runtime-owned rides reject legacy mutations so the two capacity
models cannot concurrently modify a ride. Enable only after the release gates
below pass. No production data or remote migration is changed by local tests.

## Release gates (not claims of achieved availability)

- Reconcile the remote migration ledger; snapshot and restore the full baseline.
- Review and apply the additive runtime migration with a least-privilege backend
  database role. Do not expose the private runtime schema through PostgREST.
- Configure TLS PostgreSQL, Redis, Kafka and provider credentials through secrets.
- Mapbox commercial quota, offline license and field coverage verified for every
  operating zone; never convert Google-derived provider content implicitly.
- Android physical-device validation and signed release; iOS build on macOS and
  physical-device validation, including foreground/background and force quit.
- Downloaded map/routing regions, voice, encrypted persistence and offline reroute
  must pass the 30-minute airplane-mode test before advertising offline readiness.
- Provision and exercise FCM/APNs, Twilio and a staffed 24/7 incident escalation.
- Verify 10,000 drivers / 50,000 connections / 10,000 samples per second, 24-hour
  soak, battery/thermal behavior, ETA calibration and disaster restore.
- Review privacy notice, retention, cross-border processing and ARCO workflow.

## Targets

Availability 99.95%; ingest-to-distribution p95 500 ms; moving-device position age
p95 3 s; transactional commands p95 500 ms; reconnect p95 5 s; critical provider
dispatch p95 2 s; ETA absolute error p90 2 min at horizons <=10 min; disaster RPO
5 min / RTO 30 min. Provider acceptance is not device receipt or human acknowledgement.
