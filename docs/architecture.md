# Arquitectura de KROW

Estado documentado: 20 de octubre de 2026. Alcance de la etapa actual: Android.

## Aplicaciones y responsabilidades

Este repositorio contiene dos aplicaciones independientes:

- `apps/api`: NestJS, autenticación de peticiones, reglas de viajes y reservas, Google Maps, operación del piloto y administración.
- `apps/web`: Next.js, sitio público, panel administrativo y páginas de respaldo de enlaces móviles. El login administrativo está integrado; la API comprueba el rol vigente y la cuenta, además de las protecciones de interfaz.

El repositorio separado `krow-app-mobile` contiene React Native 0.84, React Navigation y React Query. La app usa Supabase directamente para Auth; los datos de negocio se consultan y modifican por la API. Los paquetes de `packages/` comparten contratos y acceso HTTP dentro del monorepo del backend/web.

Supabase aloja Auth, PostgreSQL y Storage. La API usa clientes con identidad del usuario o el LOGIN privado limitado del piloto, según el módulo. Este LOGIN usa TLS y no es superusuario ni tiene bypass de RLS. Las mutaciones de publicación/reserva validan en servidor y en funciones/transacciones SQL; los controles de pantalla no sustituyen esas reglas.

## Navegación y estado móvil

`RootNavigator` recupera la sesión, atiende recuperación de acceso y separa autenticación de navegación principal. El acceso de conductor conserva su comprobación específica. Los stacks/tabs conducen a publicación, búsqueda, reservas, perfil, viajes programados, seguimiento e historial.

React Query administra consultas, invalidación y refrescos; los formularios y estados de interacción usan hooks locales. No se agregó Zustand ni Redux. `useCurrentUserRole` combina identidad de sesión, perfil del servidor y modo de acceso. Cambiar de cuenta o salir limpia consultas y detiene seguimiento.

Los enlaces HTTPS solo aceptan el origen aprobado y UUID de viaje válido. Un `bookingId` único y válido abre la bandeja en la solicitud concreta después de autenticación y habilitación del stack. La API vuelve a comprobar participación y estado. Las páginas web no consultan ni exponen detalles de viaje. [Contrato de enlaces](mobile-links-android-20261020.md) y [flujo de solicitudes](booking-interactions-20261020.md).

Un marcador único `invite=1` abre la vista mínima de invitación tras login. El pasajero elige paradas y solicita un lugar mediante la API existente; el conductor aprueba. No concede acceso al roster, chat o GPS. Un propietario o participante abre su detalle protegido. Las invitaciones son enlaces compartidos, según la decisión del usuario; no se creó un sistema de invitaciones dirigidas a cuentas.

Cuando no hay viaje activo, la API responde HTTP 204 y el cliente devuelve `null` sin parsear JSON. Una ausencia normal no equivale a un fallo de red/servidor. Las salidas programadas pasadas no se presentan como próximo viaje activo.

## Datos y conectividad

La app aplica timeout y cancelación a HTTP. `expectedActorId` vincula lecturas protegidas a la cuenta y queda fuera de la petición HTTP. La publicación usa una identidad persistida en Keychain/Keystore y un comprobante SQL para recuperar reintentos sin crear otro viaje.

La consulta parcial sin conexión guarda perfil y primera página de listas propias, por cuenta/API/grupo, con caducidad de lectura de 24 horas. Usa Keychain/Keystore, metadatos de consulta y revalidación; no concede habilitación para publicar ni abre acciones operativas desde copias. Requiere una sesión local utilizable. No hay cola offline de escrituras del piloto. AsyncStorage sigue destinado a preferencias y otros identificadores locales existentes.

El servidor resuelve la autoridad y concurrencia de reservas, cupo, estados y cobros. Ninguna copia local se considera confirmación de una operación remota.

## Mapas, seguimiento y eventos

La app representa mapas con las integraciones nativas existentes; la API consulta Google Maps para cálculo de rutas. El piloto utiliza avenidas y paradas publicadas por el conductor y búsqueda por destino del pasajero. Los filtros de fecha transmiten instantes UTC. La recurrencia publica un lote de hasta cuatro semanas con días seleccionados, vista previa y confirmación. Cada salida usa la API/idempotencia vigente y se administra por separado. El lote conserva identificadores y avance en Keychain/Keystore por cuenta/API para retomarlo explícitamente después de un fallo; no es creación indefinida ni escritura offline automática.

El seguimiento Android utiliza el servicio nativo y las sesiones de carga de ubicación. La API ofrece instantáneas/eventos del piloto. El runtime avanzado de Mapbox/v2 permanece separado mediante flags; estas etapas no lo activaron ni certifican su navegación offline.

El outbox y proveedor FCM distribuyen mensajes data; el receptor Android comprueba destinatario y caducidad. Firebase `krowapp` ya está configurado y los flags push están habilitados para aceptación privada en APK 0.7.0. Al abrir la app en primer plano se solicita una vez el permiso Android 13+, sin exigir login; después se registra el dispositivo automáticamente con sesión y permiso. La negativa no bloquea la app ni genera otra petición automática; Perfil conserva activación y ajustes. La API FCM aprobó una petición `validate_only` sin entrega; recepción/apertura física permanecen pendientes. Firebase no sustituye Supabase Auth o PostgreSQL.

El worker existente agrega recordatorios para conductor y pasajeros confirmados dentro de los 30 minutos previos a la salida. Usa el mismo outbox, clave única por salida/destinatario y comprobación de vigencia antes de enviar. Los avisos caducan al partir y no se envían si el viaje o reserva perdió vigencia. No se añadió un cron externo ni una alarma exacta local.

Las solicitudes y respuestas se recuperan por una consulta compartida de React Query cada tres segundos en primer plano y al reanudar; push no es la única fuente de recuperación. `booking-inbox` consulta estado vigente y participación, y reutiliza los eventos del outbox sin depender de su estado de entrega. Las confirmaciones vistas se guardan por cuenta/API en Keychain/Keystore; no son reconocimientos sincronizados entre teléfonos. No se añadió otro WebSocket.

El chat conserva paginación y reintentos idempotentes, con una lista cronológica sin transformaciones de inversión. El scroll sigue los mensajes nuevos únicamente cerca del final y conserva la posición al cargar anteriores. La estabilidad visual del teclado requiere aceptación nativa.

## Configuración y entrega

- API existente: `https://krow-api-production.up.railway.app/v1`, Railway.
- Web: `https://krow-web-gamma.vercel.app`, Vercel.
- Las variables de servidor se mantienen en los secretos del alojamiento y los archivos locales ignorados. El móvil solo incorpora configuración pública de cliente; las credenciales privadas de FCM pertenecen al backend.
- La configuración Android pública de Firebase se puede validar/importar durante el build desde `google-services.json`; no se añade una dependencia nueva ni se mezcla con la cuenta de servicio.

La API compatible está publicada: el despliegue final de invitaciones/recordatorios `54fa0b9d-1d40-49c3-ae0a-6b1ef0b167cf` alcanzó SUCCESS. Las comprobaciones HTTP de esta etapa incluyen una invitación real con ocho paradas. La comprobación SQL con LOGIN limitado aprobó y revirtió su transacción sin dejar registros de prueba. El APK 0.7.0, su firma/recursos y el respaldo web promovido se documentan en la [continuación del plan](permissions-recurrence-20261020.md). Quedan aceptación de enlaces, permisos/push, modo avión, lotes y GPS en teléfonos. El usuario indicó que agregará el callback de Auth en Supabase; no se considera guardado o validado todavía. La preparación nativa iOS sigue fuera del alcance acordado.

Las fixtures y pruebas automatizadas no acreditan estabilidad física. La reconstrucción de la base desde cero sigue limitada por el histórico inicial incompleto; el ledger recuperado no es una baseline productiva. [Etapas previas](compliance-stages2-3-20261020.md) y [estado actualizado de solicitudes](booking-interactions-20261020.md).
