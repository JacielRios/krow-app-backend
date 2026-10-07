# Provisión privada de la credencial del piloto

Este ayudante prepara la contraseña de `krow_pilot_runtime` únicamente en el proyecto `yyjbqzsokxpzhevpanyq`. Requiere Node 22 y las dependencias instaladas de la API. No crea roles ni aplica migraciones.

Antes de ejecutarlo, una migración sin credenciales debe haber creado `krow_pilot_runtime` como NOLOGIN, INHERIT, sin privilegios administrativos, sin propiedad de objetos, con límite de 12 conexiones y membresía únicamente en `krow_pilot_service`: INHERIT true, ADMIN false, SET false. El grupo también debe permanecer NOLOGIN, NOINHERIT y sin privilegios administrativos. El ayudante comprueba esa preparación y los permisos requeridos del piloto.

Esa preparación ya se aplicó y verificó el 6 de octubre de 2026 mediante
`20261006231801_pilot_runtime_login_role.sql`. El rol todavía permanece NOLOGIN;
no se asignó ninguna contraseña en MCP ni en la migración.

1. Introducir la contraseña actual de PostgreSQL `postgres` **solo en el archivo local `.temp/pilot-provision/.env`**, en el campo vacío `PILOT_ADMIN_PASSWORD`. Usar comillas si la contraseña contiene `#` o espacios. No pegarla en el chat, en un comando o en una migración. No añadir ninguna otra variable al archivo.
2. Confirmar que `apps/api/.env` contiene `PILOT_DATABASE_CA` y que `PILOT_DATABASE_URL` está ausente o vacío. El ayudante exige la CA oficial con huella DER SHA-256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
3. Desde la raíz del repositorio, ejecutar:

   ```powershell
   node scripts/provision-pilot-password.mjs
   ```

El ayudante conecta por TLS verificado a `aws-1-us-east-1.pooler.supabase.com:5432`, genera una contraseña aleatoria de 256 bits para el servicio y calcula su verificador SCRAM localmente. Dentro de una transacción asigna el verificador y habilita LOGIN. Guarda primero una copia de recuperación en `.temp/pilot-provision/runtime.env` y luego confirma la transacción.

Después comprueba una conexión nueva como el rol privado y sus permisos, sin consultar filas personales. Únicamente cuando todo aprueba añade `PILOT_DATABASE_URL` a `apps/api/.env`, conservando sus demás variables. La salida contiene solo estados y códigos, nunca contraseñas, URLs privadas, verificadores o mensajes de excepción.

La carpeta `.temp` y el entorno local están ignorados por Git y excluidos de los archivos enviados a Docker/Railway. Los archivos privados usan modo 0600 en sistemas POSIX; en Windows heredan los permisos del directorio del usuario. Conservarlos en este directorio local privado. La contraseña administrativa no se incorpora al entorno de la API ni a la credencial generada. Tras éxito, vaciar el campo administrativo con el editor privado. Cargar únicamente la URL del servicio en el gestor de secretos del alojamiento, sin mostrar su contenido en el chat.

## Recuperación sin rotación

Una interrupción puede ocurrir después de confirmar la contraseña y antes de configurar la API. Conservar `runtime.env`: contiene la única copia de recuperación de la contraseña generada. Una ejecución normal rechaza tanto una copia de recuperación existente como un rol que ya permita LOGIN, para impedir una rotación accidental.

Si existe `runtime.env`, la URL todavía no está configurada en la API y no hay otro ayudante ejecutándose, usar:

```powershell
node scripts/provision-pilot-password.mjs --recover
```

Este modo no necesita la contraseña administrativa, no modifica roles ni contraseñas y no genera otra credencial. Solo verifica la credencial guardada y configura el entorno local si aprueba. Si la transacción se revirtió, la autenticación fallará: conservar el archivo y revisar el estado del rol antes de repetir la provisión. No eliminar una copia de recuperación hasta determinar que su contraseña no está activa.

`PROVISION_LOCK_PRESENT` exige comprobar que el proceso anterior terminó antes de eliminar únicamente `.temp/pilot-provision/provision.lock`. `API_ENV_PENDING_PRESENT` exige revisar únicamente `.temp/pilot-provision/api.env.pending`; nunca imprimirlo. `RUNTIME_URL_ALREADY_CONFIGURED` detiene el proceso sin sobrescribir una configuración existente. Los demás fallos también conservan la copia de recuperación, si ya se creó.

El verificador no se guarda en el ledger de migraciones ni se envía a MCP. PostgreSQL necesariamente lo guarda en su catálogo administrativo; este procedimiento no afirma que todos los registros internos del proveedor carezcan de él. [Cifrado de contraseña en el cliente](https://www.postgresql.org/docs/17/libpq-misc.html), [formato SCRAM de PostgreSQL 17](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/common/scram-common.c), [TLS de node-postgres](https://node-postgres.com/features/ssl).
