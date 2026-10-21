# Permisos al iniciar, recurrencia, invitaciones y recordatorios

Fecha: 20 de octubre de 2026. Continuación autorizada del plan de KROW, limitada a Android y conservando React Native, React Query, NestJS, Supabase y FCM. No se añadieron librerías, servicios, tablas ni migraciones.

## Permiso y registro de notificaciones

`useNotificationPermissionStartup` solicita el permiso al abrir la aplicación en primer plano, antes del login. En Android 13 o superior utiliza el diálogo de `POST_NOTIFICATIONS`. Guarda únicamente el hecho de haberlo solicitado en AsyncStorage para respetar la negativa o el descarte y no repetir la petición en cada apertura. Un fallo nativo sin Activity permite otro intento en un arranque posterior. Android anterior a 13 usa el estado de avisos del sistema y no tiene ese diálogo. iOS no ejecuta llamadas Android y no se declara implementado su registro nativo.

La autenticación continúa aunque se rechace el permiso. `synchronizePilotPush` registra el dispositivo automáticamente cuando hay sesión y permiso concedido; ya no exige entrar primero a Perfil. Retomar la app vuelve a comprobarlo, incluida una concesión desde Ajustes. Un fallo de red permite reintento en primer plano; una negativa no genera otra petición automática. Perfil conserva activación manual y acceso a los ajustes del sistema.

Las credenciales y la petición quedan vinculadas a la cuenta que inició el registro. Cambiar de cuenta o salir desactiva inmediatamente los avisos anteriores y cancela la petición pendiente. Renovar el registro de la misma cuenta conserva su activación nativa anterior si falla la red. El permiso de ubicación se mantiene independiente y comenzar GPS no vuelve a solicitar notificaciones.

Referencia de plataforma: [permiso de notificaciones Android](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

## Publicación recurrente elegida por el usuario

El usuario eligió publicar varias fechas con vista previa y confirmación. En Publicar viaje, el conductor selecciona fecha inicial/hora, días de la semana y un periodo de una a cuatro semanas. La revisión enumera las salidas reales y el botón confirma cuántos viajes se publicarán. La recurrencia conserva la hora de Ciudad de México independientemente de la zona del teléfono, incluida una semana que atraviese cambio de mes.

Cada fecha reutiliza el contrato de publicación vigente, el cálculo de ruta del servidor y su idempotencia. Antes de enviar la primera petición, `publicationBatch` guarda en Keychain/Keystore el lote y un UUID diferente por salida. La ejecución es secuencial, requiere conexión y se inicia explícitamente; no crea viajes en segundo plano.

Si falla una petición, los viajes ya confirmados se conservan. La pantalla ofrece retomar el lote desde el primer paso, incluso tras reiniciar el proceso, y usa los mismos identificadores para recuperar una respuesta perdida. Un lote incompleto no se sustituye silenciosamente por otro formulario. Finalizar el intento descarta las fechas restantes y conserva los viajes existentes; el diálogo pide revisar Mis viajes si alguna respuesta se perdió. Al retomar, las fechas fuera del margen de 15 minutos se omiten y se informa que deben revisarse.

Límites deliberados: hasta 28 salidas, cada viaje se administra por separado y no existe creación indefinida ni edición masiva de una serie. No se promete éxito atómico de todo el lote. El servidor continúa comprobando cuenta, vehículo, catálogo, permisos, fecha y cupo de cada publicación.

## Invitación mediante enlace compartido

El usuario eligió enlace compartido con solicitud y aprobación del conductor. El botón **Invitar a este viaje** abre el panel nativo de compartir desde un viaje futuro del conductor. El enlace conserva el origen aprobado y añade un marcador único `invite=1`; el respaldo web solo conserva ese marcador válido, sin mezclarlo con un destino de reserva.

Después de iniciar sesión, el enlace abre `RideInvitation`. `GET /v1/rides/:rideId/invitation` devuelve una vista mínima a cuentas activas: recorrido, horario, nombre del conductor, descripción del vehículo, aportación, cupo y paradas activas. No devuelve lista de pasajeros, matrículas, chat, teléfonos ni GPS. Un viaje cancelado, pasado o iniciado deja de admitir una invitación para un tercero. Los participantes conservan acceso a su detalle protegido.

El pasajero debe seleccionar subida y bajada en orden y pulsar **Solicitar un lugar**. El cliente revalida antes de enviar y usa la API de reservas existente, vinculada a su cuenta. La reserva queda pendiente; el conductor la revisa en la bandeja ya implementada. Abrir el enlace no reserva, no acepta ni incrementa cupo. Si ya existe una reserva activa, se abre su detalle en lugar de insertar otra; una reserva cancelada no impide solicitar de nuevo si el viaje sigue disponible. En esta versión la invitación solicita un lugar por operación, en consonancia con el flujo elegido.

El enlace se puede reenviar: no está dirigido a una cuenta ni es una autorización para ver datos operativos. No se añadió un modelo de invitaciones privadas, conforme a la elección del usuario.

## Recordatorios de salida

El worker existente del outbox identifica cada minuto viajes programados o llenos cuya salida se encuentra dentro de los siguientes 30 minutos. Añade un aviso al conductor y a pasajeros confirmados, con clave única por viaje, salida y destinatario. No genera recordatorios a pasajeros pendientes o cancelados. Antes de enviar vuelve a comprobar estado, fecha y participación; iniciar/cancelar el viaje o cancelar la reserva invalida un recordatorio anterior. La expiración es la hora de salida.

Se reutilizan cifrado de tokens, reintentos, leases, deduplicación y FCM. Android presenta el texto de recordatorio y abre el viaje existente. No se añadió un cron de infraestructura, alarma local ni servicio externo. La entrega depende de conexión, permiso, registro y restricciones del sistema; no es una alarma exacta ni certifica recepción con cierre forzado.

## Verificación y alcance real

- API completa con PostgreSQL temporal: **197 pruebas, 28 suites**, aprobadas; el servidor temporal se detuvo al terminar.
- E2E HTTP: **9 pruebas, 2 suites**, aprobadas. Controladores y SQL reales; Auth y Maps son dobles de prueba.
- Móvil: batería completa final **269 pruebas, 44 suites**, aprobada; incluye confirmación del lote, renovación de push, cambio de cuenta y revalidación de invitación tras cancelación. Tipos y lint sin errores. El lint completo reporta advertencias de estilo y las suites antiguas emiten avisos `act` del renderer; no se declaran cero advertencias.
- Web: **57 pruebas, 12 archivos**, aprobadas, incluido tratamiento del marcador de invitación.
- Supabase real con el LOGIN limitado: **5 comprobaciones** aprobadas para vista de invitación, ausencia de lista privada, compatibilidad del outbox y descarte de recordatorio inexistente. Transacción revertida, sin escrituras de prueba persistidas y sin mensajes enviados. [Evidencia SQL](permissions-recurrence-live-20261020.json).

La recuperación de un lote y los permisos se probaron con almacenamiento/plataforma simulados. Estas pruebas no acreditan diálogo físico, Keystore real, FCM, compartir entre aplicaciones ni GPS. La publicación y el APK se registran en la evidencia de esta etapa al terminar sus comprobaciones.

## Entrega y pendientes de aceptación

El nuevo paquete privado es **0.7.0-trial**, código 12. La API de invitaciones y recordatorios conserva compatibilidad con clientes anteriores; el respaldo de invitaciones usa el mismo dominio. La firma sigue siendo de pruebas privadas, sin publicación en Play Store.

API final: `54fa0b9d-1d40-49c3-ae0a-6b1ef0b167cf`, estado SUCCESS. El ajuste final permite volver a solicitar tras una cancelación y la vista móvil revalida antes de redirigir por una reserva cacheada. APK definitivo: `C:/Users/Novasys/Documents/krow-app-mobile/artifacts/android/krow-0.7.0-trial.apk`; SHA-256 `2BCFC430CE425955CE4A9C0524279F8D23F0CAAA384EE9A101411861F1DB05E1`. Firma, versión, Hermes, Firebase y flag push comprobados; ADB no detectó dispositivos y no se instaló.

Web publicada: `dpl_YdvLJ5xsU4UMjjrmBf7j7tQQdnGy`, estado READY, promovida a `https://krow-web-gamma.vercel.app` después de comprobar el respaldo protegido. Tres comprobaciones HTTP públicas de invitación, asociación y callback aprobaron. La hidratación/apertura real de navegador y SO no se dan por probadas. [Evidencia web](permissions-recurrence-web-20261020.json).

Las comprobaciones HTTP de la API publicada están en [permissions-recurrence-http-20261020.json](permissions-recurrence-http-20261020.json); la [evidencia conjunta](permissions-recurrence-evidence-20261020.json) registra el despliegue y el hash del APK definitivo.

El usuario indicó que **agregará** `https://krow-web-gamma.vercel.app/auth/callback` a Redirect URLs de Supabase conservando las entradas actuales. Esto todavía no confirma que ya esté guardada la configuración ni que el flujo de correo completo funcione. No se enviaron correos de prueba ni se cambió la configuración de Auth mediante este entorno.

Aceptación pendiente:

1. Instalar el APK actualizado: primer inicio, permiso concedido/denegado, retorno desde Ajustes y registro real.
2. Recibir solicitudes, respuestas y recordatorio con la app abierta, en segundo plano y cerrada; abrir el destino correcto.
3. Publicar un lote privado controlado y probar pérdida/retorno de red y reanudación con Keystore real.
4. Compartir una invitación, abrirla tras login y solicitar/aprobar el lugar con dos participantes.
5. Validar GPS, mapas, modo avión, chat, accesibilidad y rendimiento en Android; iOS sigue fuera del alcance nativo acordado.
6. Cerrar la matriz de cumplimiento académico con evidencias físicas y configuración de recuperación de cuenta confirmada.

Estas implementaciones avanzan las actividades 1, 3, 5, 7, 8 y 9; no convierten automáticamente en completas las nueve actividades. El resto de las funciones anteriores —bandeja, chat, fechas y lectura parcial offline— se conserva. No se activó el runtime avanzado.

La [matriz actual de las nueve actividades](compliance-current-20261020.md) organiza la aceptación restante y la evidencia que se debe registrar.
