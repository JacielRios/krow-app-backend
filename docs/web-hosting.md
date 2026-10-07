# Publicación de la web KROW

La landing y el panel Next.js se alojan por separado de la API NestJS publicada
en Railway. La web conserva Supabase Auth y consulta la API mediante Bearer.

## Configuración de Vercel

- Cuenta/equipo comprobado: `jacielrios-projects`.
- Proyecto: `krow-web` (`prj_s7yeuJhbpikvoCYOWzmQWdxVHFSl`).
- Framework: Next.js; Node 24.
- Root Directory: `apps/web`.
- Activar archivos fuera del Root Directory para conservar `packages/*` y
  `package-lock.json`. Este ajuste se realiza en el proyecto, no como una propiedad
  `rootDirectory` de `vercel.json`.
- Build: `npm run build`; instalación desde la raíz con `cd ../.. && npm ci`.
- Output: automático.

Solo se necesitan variables públicas de frontend:

```text
NEXT_PUBLIC_API_URL=https://krow-api-production.up.railway.app/v1
NEXT_PUBLIC_SUPABASE_URL=<URL del proyecto existente>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<clave publicable del proyecto existente>
```

La clave PostgreSQL, la contraseña administrativa, Google Maps del backend y las
claves privadas permanecen fuera de Vercel. `.vercelignore` excluye `.tmp`, `.temp`,
entornos locales, certificados, backups y artefactos de compilación.

## Conexión y verificación

Después de obtener el dominio definitivo, añadir únicamente ese origen HTTPS a
`CORS_ORIGINS` de Railway, conservando los orígenes locales. No admitir todos los
subdominios de Vercel con un comodín. El login actual usa correo/contraseña; no
requiere cambiar los redirects OAuth de Supabase para funcionar.

Comprobar landing, recursos, login, rechazo del dashboard sin sesión, sesión
administrativa con datos reales, historial y CORS. Publicar siempre la versión
integrada del repositorio que contiene la administración y los módulos del piloto.

## Coste y alcance

[Vercel Hobby](https://vercel.com/docs/plans/hobby) es gratuito para uso personal
no comercial y está sujeto a límites. No se debe cambiar a un plan de pago ni
crear recursos adicionales de Railway como parte de esta publicación gratuita.
Un lanzamiento comercial requiere revisar el plan de alojamiento correspondiente.

El contenido aprobado de soporte, términos, privacidad y retención sigue
pendiente; las páginas existentes indican ese estado.

## Publicación verificada — 7 de octubre de 2026

El complemento leyó el equipo existente pero respondió HTTP 403 al crear el
proyecto. No se creó ni publicó un proyecto con esa llamada. La CLI 62.7.0 se
autorizó mediante el enlace oficial, verificó el usuario `jacielrios` y plan
`hobby`, y publicó el árbol local integrado.

- Web: [KROW](https://krow-web-gamma.vercel.app).
- Panel: [login administrativo](https://krow-web-gamma.vercel.app/admin/login).
- Despliegue: `dpl_2yQTr3UD6ajoQcZHBvpj8t9oENWx`, estado `READY`.
- Compilación Linux con Node 24, Next 16.3.6 y 17 rutas: aprobada.
- Se verificó el despliegue preparado antes de promoverlo; se mantuvo la
  protección de Vercel y la autorización propia del panel.
- Inventario revisado: 110 archivos, 918179 bytes; ningún entorno local,
  contraseña, certificado ni fuente del backend entre los archivos subidos.
- CORS permite el dominio exacto y conserva los orígenes locales. La actualización
  produjo el despliegue Railway `8b60670a-629c-45e6-932b-dab7421ba4a7`, `SUCCESS`.
- Diez comprobaciones HTTP de páginas, imágenes, readiness, CORS y rechazo
  administrativo anónimo aprobaron. Login, dashboard, historial y detalle de viaje
  reales comprobados en navegador con la cuenta autorizada.

Evidencia: [web-deployment-20261007.json](web-deployment-20261007.json).
La contraseña de `krowteam64@gmail.com` continúa únicamente en el archivo local
ignorado `.tmp/admin-integration/admin-access.txt`; es la misma cuenta de Supabase.
La publicación no requiere que el servidor local permanezca encendido.

El primer despliegue se realizó desde el árbol local integrado, antes de guardar
esa integración en Git. No se conectó despliegue automático de `master`; los
despliegues posteriores requieren publicación explícita mediante la CLI.
