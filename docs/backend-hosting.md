# Publicar la API de KROW para probar Android

## Opciones gratuitas preparadas para la prueba

**Railway es la preferencia actual del usuario**, conservando Supabase para Auth y PostgreSQL y respetando coste cero dentro del crédito Free/Trial. **Render Free** queda preparado como alternativa. La API NestJS actual distribuye instantáneas GPS por Socket.IO, guarda posiciones/sesiones en PostgreSQL y, cuando push está habilitado, despacha un outbox desde el mismo proceso. Su contenedor puede publicarse sin cambiar esta arquitectura.

Render Free duerme tras quince minutos sin tráfico entrante y puede tardar aproximadamente un minuto en despertar. La subida GPS y las consultas de un viaje activo constituyen tráfico real, pero el primer acceso tras una pausa puede requerir reintentar. También existen límites de horas/build/banda y Render puede reiniciar un servicio gratuito. Es una opción para pruebas, sin garantía de continuidad para un piloto con usuarios reales. No se añadirán pings artificiales para impedir la suspensión. [Límites de Render Free](https://render.com/docs/free), [WebSockets en Render](https://render.com/docs/websocket).

Vercel admite WebSockets y Socket.IO en Functions con Fluid Compute. Las conexiones terminan al alcanzar la duración máxima; nuevas conexiones pueden caer en otra instancia. Los contenedores de Functions también escalan a cero después de cinco minutos sin tráfico en producción. El worker periódico de KROW necesitaría un despliegue separado o su adaptación a una cola durable antes de usar esta arquitectura para el piloto. La web de KROW sí puede publicarse allí independientemente. [WebSockets](https://vercel.com/docs/functions/websockets), [contenedores](https://vercel.com/docs/functions/container-images).

## Configuración preparada

- `Dockerfile.api`: Node 22, build de la API, instalación de dependencias de producción y ejecución como usuario sin privilegios.
- `.dockerignore`: excluye entornos, claves, dumps, archivos locales y dependencias de la imagen.
- `.railwayignore`: excluye esos archivos también del archivo que `railway up` transmite antes de construir la imagen; respetar igualmente `.gitignore` y nunca usar `--no-gitignore`.
- `render.yaml`: servicio **plan `free`**, una instancia, readiness, sin autodeploy ni secretos en el archivo.
- `railway.json`: referencia local de build desde la raíz, readiness y reinicios. Los servicios nuevos ya no pueden activar Config as Code: configurar esos mismos valores en el servicio y `RAILWAY_DOCKERFILE_PATH=Dockerfile.api`. [Cambio de configuración](https://docs.railway.com/config-as-code).
- El servidor ya escucha en `0.0.0.0` y en `PORT`; cierra conexiones y temporizadores cuando recibe la señal de apagado.

Esta configuración no crea proyectos, compra planes, aplica migraciones ni publica automáticamente el código local.

## Variables del servicio

Configurar valores reales en el gestor de secretos del alojamiento. Ningún secreto del backend debe copiarse al APK ni al repositorio.

| Variable | Valor o procedencia |
| --- | --- |
| `NODE_ENV` | `production` (incluido en la imagen). |
| `HOST` | `0.0.0.0` (incluido en la imagen). |
| `PORT` | Railway: `3000` explícito, igual al targetPort del dominio. Otros alojamientos pueden inyectarlo; la imagen usa `3000` como respaldo. |
| `SUPABASE_URL` | URL del proyecto actual de Supabase. |
| `SUPABASE_ANON_KEY` | Clave pública de ese proyecto; el backend valida la identidad de cada JWT. |
| `GOOGLE_MAPS_API_KEY` | Clave del servidor con APIs de rutas/lugares habilitadas; distinta de la clave Android. |
| `GOOGLE_MAPS_REQUESTS_PER_MINUTE` | `250` inicialmente; ajustar a la cuota acordada. |
| `CORS_ORIGINS` | Orígenes web autorizados separados por comas. El blueprint utiliza una lista vacía porque el APK nativo no requiere un origen web. |
| `RIDE_PILOT_ENABLED` | `true` únicamente después de completar migraciones y validar el usuario privado. |
| `RIDE_TRACKING_ENABLED` | `true` con piloto y Google Maps configurados. |
| `PILOT_DATABASE_URL` | Conexión del LOGIN privado que hereda `krow_pilot_service`, con contraseña única; no usar `postgres`, un propietario ni `service_role`. |
| `PILOT_DATABASE_CA` | Certificado CA del proyecto para verificar TLS. Admite PEM con saltos de línea o `\n` literales. |
| `RIDE_RUNTIME_ENABLED` | `false`: el runtime avanzado y su Redis/Kafka no son necesarios para este piloto. |
| `PILOT_PUSH_ENABLED` | `false` hasta configurar Firebase; con `true` agregar los secretos del bloque siguiente. |
| `PILOT_ACCOUNT_CLOSURE_ENABLED` | `false` hasta contar con soporte, privacidad y retención aprobados. |

Push requiere `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` y `PILOT_PUSH_ENCRYPTION_KEY` (32 bytes aleatorios codificados en base64). Mantener estable la clave de cifrado para leer los tokens existentes; una rotación requiere un procedimiento de migración. No se necesitan APNs, Mapbox, Twilio ni PagerDuty para Android/GPS online.

Usar la conexión directa de Supabase si el alojamiento tiene IPv6. Si se necesita pooler, usar **modo sesión** con el usuario privado según el formato de conexión de Supabase, y verificar que readiness reconozca su identidad y permisos. No incluir parámetros `sslmode`, `sslrootcert`, `sslcert` o `sslkey` en esa URL: `pg` puede sustituir con ellos la configuración TLS que verifica `PILOT_DATABASE_CA`. No desactivar `rejectUnauthorized`.

El host de sesión confirmado es `aws-1-us-east-1.pooler.supabase.com:5432`, base `postgres`, usuario `krow_pilot_runtime.yyjbqzsokxpzhevpanyq`. El grupo `krow_pilot_service` permanece NOLOGIN. El rol `krow_pilot_runtime` ya está habilitado con una credencial aleatoria limitada, verificada por TLS y guardada en Railway con autorización explícita. No tiene SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION ni CREATE sobre los esquemas o la base; hereda el grupo sin ADMIN ni SET.

La CA pública oficial `Supabase Root 2021 CA` se descargó desde [el certificado publicado por Supabase](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) y se verificó su huella DER SHA-256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`; está configurada únicamente en `apps/api/.env`, ignorado por Git. Esta comprobación del certificado no equivale a una conexión PostgreSQL autenticada.

El handshake PostgreSQL/TLS del host confirmó CA y hostname. La autenticación y permisos del LOGIN limitado aprobaron después mediante el ayudante `--recover`; Railway también confirmó acceso a la base con `/v1/health/ready` y resultado `pilot: ready`.

`scripts/provision-pilot-login.psql` conserva la alternativa administrativa original y no se ejecutó. La provisión real usó la [función temporal autorizada](../scripts/provision-pilot-edge/README.md), con token aleatorio y caducidad absoluta de diez minutos. Preflight y provisión aprobaron; la versión 3 de la función responde HTTP 410 `RETIRED` y no accede a SQL ni al entorno. Después, [el ayudante de contraseña](../scripts/provision-pilot-password.md) verificó el runtime con `--recover`. La contraseña administrativa no se exportó ni se modificó. El LOGIN ya está configurado: no repetir la provisión ni rotarlo para continuar.

```text
postgresql://krow_pilot_runtime.yyjbqzsokxpzhevpanyq:<CONTRASEÑA_CODIFICADA>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

El LOGIN administrativo se utiliza únicamente durante esa provisión; nunca se configura en el servicio ni se incorpora al APK. [Gestión de contraseñas con psql](https://www.postgresql.org/docs/17/app-psql.html), [herencia de roles](https://www.postgresql.org/docs/17/sql-grant.html).

## Desplegar en Render Free

1. Conectar la cuenta Render y el repositorio. El build debe incluir los cambios locales actuales; publicarlos en una rama revisada antes de crear el Blueprint desde GitHub.
2. Crear un Blueprint con `render.yaml`. Revisar que el servicio sea **Free** y que no se creen bases, discos o servicios de pago. Elegir región cercana a Supabase antes de la creación, modificando `region` si corresponde; si se omite, Render utiliza Oregon.
3. Introducir en el gestor de secretos las cinco variables `sync: false`: URL/clave pública de Supabase, clave Google Maps del servidor, conexión privada PostgreSQL y certificado CA. El blueprint habilita piloto/GPS; completar primero los permisos y el LOGIN privado para que readiness apruebe.
4. Conservar Root Directory vacío, Dockerfile `./Dockerfile.api`, Docker Build Context `.` y Health Check `/v1/health/ready`. La API utiliza `PORT` inyectado por Render. Las actualizaciones se desplegarán manualmente (`autoDeployTrigger: off`) para evitar cambios durante un viaje.
5. Obtener el dominio HTTPS `https://<servicio>.onrender.com` y verificar `/v1/health` y `/v1/health/ready`. Con piloto activo, debe devolver `pilot: "ready"`; un health genérico no demuestra que SQL y permisos estén listos.
6. Probar una consulta autenticada y Socket.IO en namespace `/v1/tracking`, path `/socket.io`, transporte `websocket`. Verificar reconexión después de reiniciar y de un periodo de suspensión.
7. Configurar `KROW_API_URL=https://<servicio>.onrender.com` en Android **sin añadir `/v1`**, recompilar el APK y probar desde otra red. Tras inactividad, abrir health y esperar que el servicio despierte antes de iniciar la prueba.

La región y los secretos deben corresponder a la cuenta real. El archivo no publica código ni conecta una cuenta por sí mismo. [Referencia de Blueprints](https://render.com/docs/blueprint-spec).

## Railway, preferencia actual del usuario

El usuario instaló Railway y pidió configurarlo. La documentación actual incluye un plan Free con US$5 durante la prueba inicial de 30 días y posteriormente US$1 de crédito de recursos al mes, sin tarjeta obligatoria. Verificar el plan y crédito de su workspace antes de crear o desplegar recursos; no activar Hobby/Pro ni facturación. El crédito limita el tiempo de uso disponible y no garantiza un backend permanentemente activo. [Planes actuales](https://railway.com/pricing).

1. Conectar la cuenta y seleccionar el proyecto/repositorio de KROW. El build debe incluir los cambios locales actuales; si se usa GitHub hay que publicarlos en una rama revisada antes de activar autodeploy.
2. Crear un servicio web desde este monorepo, con **Root Directory `/`**, `RAILWAY_DOCKERFILE_PATH=Dockerfile.api`, readiness `/v1/health/ready` (120 segundos) y reinicio `ON_FAILURE` con máximo diez intentos. Los servicios nuevos no pueden activar Config as Code; `railway.json` documenta los valores pero no sustituye la configuración del servicio. El Dockerfile necesita todos los manifiestos de workspaces; no cambiar la raíz a `apps/api`.
3. Elegir una región cercana a Supabase. Mantener **una réplica**. Comprobar el consumo y límites del plan Free/Trial. Serverless debe estar deshabilitado durante ensayos GPS continuos; si se habilita para ahorrar crédito, validar expresamente cold start, reconexión y continuidad del viaje.
4. Cargar las variables anteriores. No crear una segunda base de datos: la API sigue usando la de Supabase.
5. Configurar `PORT=3000` y generar el dominio HTTPS con targetPort `3000`. Un healthcheck interno aprobado no garantiza que el puerto del dominio coincida con el del proceso.
6. Verificar `GET https://<dominio>/v1/health` y `GET https://<dominio>/v1/health/ready`. Con el piloto activo, readiness debe devolver `pilot: "ready"`; un health genérico no demuestra que SQL y permisos estén listos.
7. Probar una consulta autenticada y la conexión Socket.IO en namespace `/v1/tracking`, path por defecto `/socket.io`, transporte `websocket`. Comprobar la reconexión después de reiniciar el servicio.
8. Configurar `KROW_API_URL=https://<dominio>` en la compilación Android **sin añadir `/v1`**, recompilar el APK y comprobar el flujo de dos cuentas desde otra red.

Railway permite despliegues desde Dockerfile y dominios HTTPS. Serverless puede pausar un servicio y provocar demora o un 502 en el primer acceso; por eso queda desactivado durante la prueba. [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [configuración](https://docs.railway.com/config-as-code/reference), [Serverless](https://docs.railway.com/deployments/serverless), [planes](https://docs.railway.com/pricing/plans).

## Verificación reproducible de la imagen

Desde la raíz, con Docker disponible:

```powershell
docker build -f Dockerfile.api -t krow-api .
docker run --rm --env-file apps/api/.env.production.local -p 3000:3000 krow-api
```

El archivo de entorno debe existir solo localmente y contener las variables aprobadas. El `.dockerignore` impide incluirlo en el build; `--env-file` lo entrega al contenedor durante su ejecución. En Linux también se pueden utilizar estos mismos comandos.

Tras una actualización, esperar readiness, repetir consulta autenticada y verificar reconexión GPS. Si falla, detener el rollout y restaurar la versión anterior del servicio; no revertir datos ni migraciones automáticamente. Programar despliegues cuando no haya viajes activos durante el piloto.

## Comprobaciones locales de esta preparación

El 6 de octubre de 2026 se verificaron el parseo YAML del Blueprint, el JSON de Railway, la instalación aislada de la API con `npm ci` y su compilación. Otra instalación con `--omit=dev` arrancó correctamente: health/readiness respondieron, `/v1/me` rechazó la ausencia de JWT con 401 y el servidor aceptó el upgrade WebSocket. Se comprobó que todas las dependencias declaradas se resolvieran dentro de esa instalación de producción, sin depender de paquetes del workspace principal.

Estas comprobaciones locales utilizaron credenciales sintéticas y el piloto desactivado; no contactaron Supabase, Google Maps ni FCM. No verifican permisos SQL reales, TLS del pooler ni seguimiento de un viaje. Docker no está instalado en este entorno; Railway construyó posteriormente la imagen Linux real y la desplegó.

## Servicio publicado el 6 de octubre de 2026

Proyecto `krow-api-pilot`, servicio `krow-api`, entorno `production`: [API pública](https://krow-api-production.up.railway.app/v1/health). Se guardaron las variables autorizadas por el usuario, sin incluirlas en el código ni en el archivo subido. No se crearon bases, volúmenes, planes de pago ni métodos de pago.

El despliegue `47d2d1b4-0482-40bc-a9a2-33bef3dc6db3` aprobó la construcción Linux y readiness. Las comprobaciones públicas devolvieron 200 en health/readiness, 401 en `/v1/me` sin JWT y apertura del transporte Engine.IO por WebSocket. Proceso y dominio usan puerto 3000 explícito. Ver [evidencia sanitizada](railway-deployment-20261006.json).

La primera publicación conservó los flags desactivados. El despliegue posterior `1aefd56f-8751-435e-8699-c6155ab14e22` alcanzó SUCCESS con `RIDE_PILOT_ENABLED=true` y `RIDE_TRACKING_ENABLED=true`. La comprobación pública de readiness devolvió `pilot: ready`, validando SQL y permisos desde Railway; `/v1/me` y tracking sin JWT devolvieron 401. El transporte WebSocket aprobó. Ver [evidencia de activación](railway-pilot-activation-20261006.json). Esto todavía no certifica seguimiento autenticado de un viaje ni GPS en un teléfono físico.

La URL ya está en los archivos móviles ignorados. El usuario autorizó después usar temporalmente la misma clave Maps para el APK privado; quedó en `android/local.properties`. El APK generado es `krow-app-mobile/artifacts/android/krow-trial.apk`, con piloto/GPS activados, ARM64/ARMv7 y bundle incluido. Firma, manifiesto y ausencia de credencial privada PostgreSQL aprobaron; instalación y mapas/GPS físicos quedan pendientes. La distribución posterior debe separar las claves del servidor y del SDK Android. El consumo/factura observado tras desplegar fue US$0; el crédito Trial/Free sigue siendo limitado.

La credencial privada ya quedó provisionada mediante la función temporal autorizada y verificada con el ayudante local en modo recuperación. Sus archivos privados permanecen excluidos de Git, Docker y Railway. La función retirada no permite volver a acceder a la base. No se necesita conocer ni restablecer la contraseña administrativa para continuar.

Las migraciones finales `20261007002518_pilot_profile_privacy` y
`20261007002528_pilot_api_cutover` también están aplicadas. Los clientes ya no
pueden leer perfiles completos ni escribir viajes/reservas directamente. La API
conserva sus permisos privados y readiness aprobó después del cambio. Utilizar el
APK actualizado para las pruebas. Ver [resultado y pendientes](pilot-test-release-20261006.md).
