# KROW: implementación de estabilización y actualización del piloto

Fecha: 16 de octubre de 2026. Alcance: aplicación Android, API NestJS, Supabase y panel Next.js.

Se implementaron las correcciones descritas a continuación y se actualizó el piloto existente con autorización expresa del usuario. Esta entrega todavía requiere validación física y trabajos de preparación productiva. El lanzamiento público completo permanece pendiente.

## Cambios implementados

| Área | Resultado |
|---|---|
| Mapas Android | react-native-maps fijado en 1.29.11. RoutePreviewMap espera a que la instancia esté lista antes de enviar mapPadding. Se conserva la protección de layout, cámara y coordenadas. APK recompilado con Fabric y Hermes. |
| Diagnóstico | Android guarda localmente el último fallo Java no capturado y su cadena de causas. Perfil permite compartir el diagnóstico voluntariamente. Se registran versión, dispositivo y frames acotados; no mensajes de excepción, tokens, chat ni coordenadas. El boundary registra el tipo de error React. |
| Perfil | Inicialización académica desde el trigger de Auth incluso cuando el registro requiere confirmar correo; reparación controlada de campos nulos existentes. Las columnas del perfil son la fuente de verdad después de editar. Semestre editable de 1 a 20 y fotografía mediante URL HTTPS opcional. |
| Métricas del conductor | Nueva pantalla con viajes y pasajeros de los últimos 30 días, importes comprometidos, efectivo cobrado, pendiente y calificación. Datos acotados al usuario autenticado. |
| Paradas | Nueva pantalla administrativa de búsqueda, creación y edición. Asociación a avenida, sentido, orden, coordenadas, tipo y estado; conserva puntos generales/campus. Orden activo único por avenida y auditoría. Se impide desactivar una parada con reservas pendientes. Las coordenadas de viajes ya publicados conservan su snapshot. |
| Recálculo compartido | El conductor puede solicitar una actualización desde Tracking con GPS reciente y preciso. La API calcula desde su posición, conserva los puntos pendientes de subida y bajada y publica una sola geometría para los participantes. Controla versiones, cambios de reservas y solicitudes simultáneas. |
| Incidencias | Reporte por participante con identificador idempotente; cola administrativa para reconocer y resolver con auditoría. Este canal necesita personal que lo atienda: no ofrece respuesta inmediata. |
| Operación | Nueva página del panel con viajes activos, antigüedad de señal GPS, eventos de notificaciones y reportes pendientes. Consulta periódica mientras la página está visible. |
| Habilitación | Se revalida conductor aprobado, cuenta activa y licencia vigente al publicar y comenzar. La revisión estricta de licencia, seguro y circulación está implementada detrás de RIDE_DOCUMENT_CHECKS_REQUIRED; sigue desactivada en el piloto hasta preparar y revisar el catálogo documental. Cancelar y terminar siguen disponibles. |
| Notificaciones | Limpieza de eventos vencidos incluso con push apagado. La entrega FCM continúa desactivada por faltar Firebase y su configuración. |
| Seguridad de datos | Se revocaron las escrituras de clientes sobre payments. La confirmación de un cobro futuro queda reservada a un flujo de servidor. Las tablas privadas de rutas operativas e incidencias tienen RLS y permisos del rol limitado de la API. |
| Administración | La escritura de paradas comprueba tanto el rol del token como la condición actual de la cuenta administrativa en Auth y users; rechaza cuentas desactivadas y roles retirados. |
| Dependencias y errores | Next.js fijado en 16.3.8; cliente administrativo con timeout de 15 segundos y cancelación. Las pantallas antiguas de finalización con datos ficticios dejaron de estar enlazadas por la navegación principal. |

El recálculo se solicita desde el conductor y requiere conexión. Todavía no constituye navegación automática ante cada desvío ni navegación sin conexión. El diagnóstico local tampoco sustituye un servicio remoto de monitoreo ni captura todas las señales de fallo C++/sistema.

La gestión de documentos, login y seguimiento existentes siguen necesitando el recorrido integral de aceptación. La edición de foto por URL no incluye selección o subida desde la galería.

## Despliegue realizado

- API: https://krow-api-production.up.railway.app/v1
- Panel: https://krow-web-gamma.vercel.app
- Railway: d2f5d2f9-742d-4b7f-8be4-ec12aa4fa21d, estado SUCCESS.
- Vercel: dpl_Dq9jUTWk3XdAhubsWzrkLh4JG6Hs, estado READY, dominio habitual comprobado después de promover.
- Fuentes: cambios locales sobre el commit de backend 6b28829f224f7a70b28a2da329e5f765ad206eac. Los cambios permanecen sin commit en ambos repositorios.

Se aplicaron individualmente cinco migraciones, sin ejecutar un db push indiscriminado ni activar el runtime avanzado:

1. 20261016175150_launch_profile_security.sql
2. 20261016175213_admin_corridor_stops.sql
3. 20261016175233_pilot_operations.sql
4. 20261016175249_launch_query_indexes.sql
5. 20261016175940_harden_admin_stop_actor.sql

Los nombres locales se reconciliaron con las versiones asignadas por Supabase. El [ledger exportado](migration-ledger-launch-20261016.json) conserva los SQL aplicados; el verificador ahora comprueba 43 migraciones recuperadas. Este control no acredita todavía una instalación completa desde cero.

Antes y después se conservaron 52 viajes, 36 reservas, 12 usuarios y 21 paradas. La verificación SQL de alta de parada por un administrador se ejecutó dentro de una transacción revertida. No se crearon viajes, reservas ni reportes de prueba permanentes.

Después de la reparación: cero perfiles con el desfase académico examinado, cero eventos push pendientes vencidos y ningún conductor aprobado con licencia vencida o ausente. Las peticiones autenticadas de métricas, catálogo y operación respondieron 200; las peticiones privadas sin sesión respondieron 401. El panel muestra acceso protegido sin una sesión administrativa.

Evidencia HTTP y permisos: [launch-live-checks-20261016.json](launch-live-checks-20261016.json).

## APK para probar

Ruta: C:/Users/Novasys/Documents/krow-app-mobile/artifacts/android/krow-trial.apk

- Paquete: com.krownmobileapp.
- Versión: 0.3.0-trial; versionCode: 5.
- Android mínimo: 7 (API 24); target/compile SDK: 36.
- ABI: arm64-v8a y armeabi-v7a.
- Tamaño: 136989598 bytes.
- SHA256: 7618CFA3948461E3B5C63BBDF089FD97F4265755286C64706F301A4711199CFB.
- Firma de prueba Android Debug verificada; JavaScript y Hermes incluidos, sin requerir Metro.
- Las 1490 entradas del APK se inspeccionaron sin encontrar la conexión ni la contraseña privada PostgreSQL del backend.

No se reprodujo el reporte original en teléfono ni se obtuvo logcat. La vulnerabilidad nativa identificada se corrigió en la dependencia y la integración compiló, pero el incidente permanece abierto hasta validar el APK físicamente.

## Validación

| Comprobación | Resultado |
|---|---|
| Móvil | TypeScript y lint aprobados; 172 pruebas en 28 suites. |
| API | TypeScript, lint y compilación aprobados; 165 pruebas generales y 13 de PostgreSQL real aprobadas (178 en total). |
| Contratos HTTP | 6 pruebas aprobadas. |
| Panel | 41 pruebas en 10 archivos; TypeScript y compilación productiva local y Vercel aprobados. |
| Importador | 6 pruebas aprobadas. |
| SQL nuevo | Pruebas PGlite para perfiles, permisos, catálogo, incidencias y documentos; cinco migraciones aplicadas en PostgreSQL real. Alta administrativa transaccional revertida. |
| Native Android | assembleTrial aprobado con Kotlin, mapas y diagnóstico; versión, arquitectura, hash y firma del APK verificados. |
| Despliegue | Health/readiness 200; autorización 401 sin sesión; consultas administrativas y de usuario 200; validación de filtro inválido 400. |

Los mocks de mapas y las pruebas SQL no certifican continuidad GPS, consumo de batería ni estabilidad del SDK en un dispositivo.

Las 13 pruebas antes omitidas se ejecutaron en PostgreSQL 17.11 temporal con datos sintéticos y bases aisladas: competencia por el último asiento, reservas duplicadas, comienzos simultáneos, transacciones, privacidad, idempotencia y permisos. El servidor escuchó solo en loopback y se apagó al terminar. Se corrigió el fixture del piloto: String.replace interpretaba los delimitadores SQL $$ como sustituciones; ahora usa una función de reemplazo que conserva el SQL.

Para repetirlas en Windows, ejecutar `powershell -File scripts/test-postgres-local.ps1 -PostgresBin RUTA_A_BINARIOS_POSTGRESQL`. El parámetro acepta una carpeta absoluta o relativa al repositorio. La descarga local proviene de los [binarios oficiales EDB enlazados por PostgreSQL](https://www.postgresql.org/download/windows/); las herramientas y los clústeres temporales quedan en .tmp, ignorado por Git. Evidencia: [postgres-tests-20261016.json](postgres-tests-20261016.json).

La auditoría npm de producción API/web reportó cero avisos. El toolchain de desarrollo del backend conserva 35 avisos agregados (10 altos y 25 moderados); se actualizó localmente Handlebars a 4.7.10 para retirar el aviso crítico de la herramienta de pruebas. Esta actualización del toolchain es posterior al despliegue y no afecta al runtime de producción, que no incluye ese paquete. El móvil conserva 34 avisos agregados del toolchain/dependencias (29 altos y 5 moderados); no se realizó una actualización mayor forzada de React Native.

Supabase dejó de informar claves foráneas sin índice y el índice duplicado examinado. Continúan 19 avisos de evaluación RLS, 4 de políticas permisivas múltiples, 12 funciones SECURITY DEFINER accesibles a autenticados y protección de contraseñas filtradas desactivada. La accesibilidad de una función no demuestra por sí sola una vulnerabilidad; falta terminar la revisión individual. Los índices nuevos aparecerán inicialmente sin uso.

Referencias de remediación: [funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [evaluación RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Trabajo pendiente para lanzamiento público

| Prioridad | Trabajo pendiente | Dependencia o aceptación |
|---|---|---|
| P0 | Validar cierre al abrir rutas y tracking físico | Android real: aperturas repetidas, regreso inmediato, navegación rápida, GPS denegado/revocado/apagado, pérdida de red y recorrido de al menos 30 minutos con pantalla bloqueada. Conservar diagnóstico y logcat. |
| P1 | Recuperación de contraseña y enlaces verificados | El equipo aún no tiene dominio/redirects aprobados. Configurar Supabase, correo y enlaces Android/iOS; probar apertura en frío y cambio real de contraseña. |
| P1 | Entrega push | El equipo aún no confirma proyecto Firebase. Incorporar configuración y credenciales mediante secretos, activar flags y verificar consentimiento, token, envío, recepción y apertura autorizada. |
| P1 | Incorporación y habilitación documental | Completar experiencia del conductor, carga/revisión documental y activar RIDE_DOCUMENT_CHECKS_REQUIRED al preparar la operación pública. |
| P1 | Base reproducible y recuperación | Completar baseline histórico y un staging de Supabase reproducible, y ensayar el respaldo/restauración completos. Las 13 pruebas de PostgreSQL y la competencia por el último asiento ya aprobaron en bases temporales. |
| P1 | Soporte, privacidad y cierre | Faltan contactos y URLs aprobadas. Definir personal y atención de incidencias, retención, borrado/anonimización y políticas. El cierre de acceso existente no completa el borrado. |
| P1 | iOS | Compilar en macOS/Xcode y completar/validar tracking y push del piloto en dispositivo físico. |
| P1 | QA integral | Dos cuentas/dispositivos: publicar, reservar, aceptar, chatear, iniciar, subir, bajar, cobrar efectivo, finalizar y reseñar. Cambio de cuenta, duplicados, reconexión, renovación de sesión y reinicio de API. |
| P2 | Monitoreo productivo y capacidad | Integrar captura remota de cierres/alertas con un servicio definido; medir WebSocket, PostgreSQL, API, GPS, batería y varias réplicas antes de escalar. |
| P2 | Seguridad y rendimiento pendientes | Revisar contratos de las 12 funciones, permisos, RLS, contraseñas filtradas y toolchain; usar planes reales antes de alterar políticas o retirar índices. |
| P2 | Navegación dinámica completa | Automatizar desvíos y ETA con pruebas físicas; resolver incorporación y reconciliación del runtime avanzado antes de activarlo. |
| P2 | Distribución y accesibilidad | Firma productiva, AAB, políticas de tiendas, accesibilidad, compatibilidad y QA visual en teléfonos. |
| Excluido por ahora | Pagos digitales | El usuario indicó expresamente que aún no se implementen. El efectivo continúa; no se eligió proveedor ni reglas de comisión, liquidación o reembolso. |

No se inventaron dominios, contactos ni políticas. Push, cierre de cuenta y runtime avanzado conservan sus condiciones de activación; no se habilitaron servicios de pago ni se contrataron planes.

