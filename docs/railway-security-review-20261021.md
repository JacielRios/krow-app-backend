# Revisión de Railway y publicación pendiente

Revisión del 21 de octubre de 2026. Esta nota no contiene credenciales ni certifica que la cuenta esté libre de compromiso.

## Estado comprobado

- Railway confirmó un incidente relacionado con variables de entorno y mantuvo pausados los despliegues. El intento de publicar el API de KROW volvió a responder `Deploys have been paused temporarily`.
- El API existente respondió **200** en `/v1/health/ready`.
- Se inventariaron **32 nombres** de variables del servicio. Sus valores no se guardaron en el informe ni se mostraron.
- Una muestra de los últimos **200 registros HTTP**, entre 22:36 y 22:40 UTC, mostró solicitudes a rutas existentes de KROW y respuestas 200, 201, 204 y 304. Esa muestra solo cubre unos minutos y **no permite descartar accesos indebidos**. La consulta de registros de aplicación no devolvió entradas en el periodo solicitado.
- El rol de conexión `krow_pilot_runtime` no es superusuario, no tiene `BYPASSRLS` ni permiso para crear roles. Esta comprobación no sustituye la revisión de los permisos de cada función.

## Credenciales que requieren rotación coordinada

| Variable                    | Acción necesaria                                                                                                                                | Dependencia                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PILOT_DATABASE_URL`        | Cambiar la contraseña del rol privado de conexión y actualizar la conexión del API.                                                             | El API necesita cargar la nueva conexión; revocar la anterior antes impide reconexiones.                                                                   |
| `GOOGLE_MAPS_API_KEY`       | Reemplazar la clave privada del backend, mantener sus restricciones y revocar la anterior después de comprobar geocodificación y rutas.         | Acceso administrativo al proyecto de Google Cloud y despliegue del API. No reutilizar la clave web.                                                        |
| `FCM_PRIVATE_KEY`           | Crear una clave de reemplazo de la misma cuenta de servicio, actualizar el API, comprobar el envío y eliminar la clave anterior.                | Acceso IAM al proyecto Firebase/Google Cloud y despliegue del API. No ampliar permisos.                                                                    |
| `PILOT_PUSH_ENCRYPTION_KEY` | Rotar la clave de cifrado conservando el acceso a los tokens existentes mediante recifrado transaccional o una transición de claves verificada. | Copia de recuperación privada, acceso a los tokens cifrados y coordinación con las instancias del API. Reemplazar solo la variable rompería el descifrado. |

`SUPABASE_ANON_KEY` es una clave pública del cliente. Rotar firmas JWT o claves públicas indiscriminadamente afectaría también a los APK instalados; no reemplaza la rotación de las credenciales privadas anteriores. URLs, identificadores, certificados públicos y banderas no son secretos.

No se revocaron credenciales durante esta revisión: los despliegues siguen bloqueados y no se ha verificado una sesión administrativa de Google Cloud/IAM para reemplazar las claves externas. La rotación está pendiente, no completada. No existe evidencia suficiente para afirmar que las credenciales de KROW hayan sido extraídas; el proveedor recomienda actuar de forma preventiva.

## Publicación preparada

La compilación final del panel se subió a Vercel en `dpl_ACrGFouFhHrrqsp3WJ6AfiHkiMdb`, producción sin asignación del dominio, con estado **READY**. Pasaron las comprobaciones de siete páginas y trece recursos, incluidos el mapa Google, el contrato `dropoff_only` y la llamada de autocompletado. Incluye la automatización de descensos y el texto actualizado del módulo. El dominio público conserva la versión anterior hasta que el API soporte el nuevo formulario.

El APK móvil **0.8.1-trial**, código de versión 14, se generó con ARM64 y ARM de 32 bits. Su firma de pruebas coincide con la versión anterior; se verificaron el bytecode Hermes integrado, la ausencia de modo depurable y HTTP sin cifrar, y la presencia del contrato de descenso exclusivo. La evidencia de compilación está en el repositorio móvil; no se comprobó instalación física.

Para finalizar cuando Railway restablezca el servicio:

1. Coordinar los reemplazos de credenciales y su carga sin exponer sus valores en consola, Git, APK o artefactos públicos.
2. Publicar el API validado en el proyecto, entorno y servicio existentes de Railway; esperar estado correcto y `/v1/health/ready` 200.
3. Comprobar el endpoint administrativo `/admin/transport-stops/suggest`, geocodificación y el catálogo sin crear registros de prueba.
4. Comprobar la compilación final de Vercel, promoverla y verificar el dominio público.
5. Verificar notificaciones y eliminar las credenciales anteriores después de la transición. La revocación inmediata antes de la transición requiere asumir una interrupción explícita.

Fuentes oficiales: [estado de Railway](https://status.railway.com/) y [comunicado de seguridad](https://blog.railway.com/p/security-disclosure-wednesday-october-21st).
