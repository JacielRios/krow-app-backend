# KROW Platform

Monorepo de KROW. Contiene la API de negocio, el landing público y el
panel administrativo funcional. La aplicación móvil continúa en el repositorio
`krow-app-mobile`.

Web pública: [KROW](https://krow-web-gamma.vercel.app).
Panel: [acceso administrativo](https://krow-web-gamma.vercel.app/admin/login).
La web está publicada en Vercel Hobby y consulta la API de Railway; consulta
[la guía y evidencia de publicación](docs/web-hosting.md).

## Estructura

```text
apps/
├── api/                 API NestJS
└── web/                 Landing y administración en Next.js
packages/
├── api-client/          Cliente HTTP compartido
├── contracts/           Contratos TypeScript
└── shared-config/       Configuración reutilizable
supabase/
└── migrations/          Cambios versionados de PostgreSQL
docs/
└── architecture.md      Decisiones de arquitectura
```

`apps/api` y `apps/web` son aplicaciones independientes. Para la prueba Android
el usuario eligió Railway, conservando Supabase y usando únicamente su crédito
gratuito; consulta la [guía de alojamiento](docs/backend-hosting.md). Render Free
queda preparado como alternativa y la web puede alojarse por separado en Vercel.
La API está publicada en [Railway](https://krow-api-production.up.railway.app/v1/health),
con piloto/GPS activados y conexión PostgreSQL limitada verificada. Consulta la
[evidencia de activación](docs/railway-pilot-activation-20261006.json).

## Requisitos

- Node.js 24 recomendado, o 22.22.2 o superior dentro de la rama 22.
- npm 10 o superior.
- Un proyecto de Supabase para probar los flujos reales.

## Instalación

Desde la raíz ejecuta `npm ci` y copia las configuraciones:

```text
apps/api/.env.example  → apps/api/.env
apps/web/.env.example  → apps/web/.env.local
```

## Desarrollo local

Ejecuta cada aplicación en una terminal distinta:

```bash
npm run dev:api
npm run dev:web
```

- API: `http://localhost:3000/v1`
- Health check: `http://localhost:3000/v1/health`
- Swagger: `http://localhost:3000/v1/docs`
- Web: `http://localhost:3001`

## Verificación

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:web
npm run test:migrations
npm run test:stops-import
npm run build
```

## API actual

La implementación local del piloto Android y sus pendientes están registrados en
[estado del roadmap y activación coordinada](docs/pilot-implementation.md).
El piloto añade GPS online, chat, efectivo y reseñas bajo flags independientes
del runtime avanzado. Las migraciones, el LOGIN privado con privilegios limitados
y el cambio de permisos ya están aplicados en Supabase. La API está activa en
Railway con TLS y aprobó health/readiness y comprobaciones de autorización.
La integración administrativa y sus verificaciones reales están registradas en
[el informe de integración](docs/admin-integration-20261007.md).
La publicación por avenida, selección explícita de bajadas y búsqueda por destino
del piloto se describen en [avenidas y emparejamiento](docs/pilot-corridors-20261007.md).

La API valida tokens de Supabase Auth y expone perfiles, vehículos, viajes,
reservas, matching y Google Maps bajo `/v1`. Los flujos protegidos esperan
`Authorization: Bearer <supabase_access_token>`.

La configuración mínima incluye `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GOOGLE_MAPS_API_KEY` y `CORS_ORIGINS`. El piloto usa además `PILOT_DATABASE_URL`
y los flags de `apps/api/.env.example`. El backend no usa una `service_role`
para los flujos móviles actuales.

## Panel administrativo

La web permite iniciar sesión con Supabase y verifica acceso mediante
`GET /v1/admin/me`. Incluye gestión de conductores y vehículos, documentos privados,
historial de viajes con detalle y filtros, auditoría y dashboard con métricas reales.
La API y PostgreSQL comprueban el rol administrativo vigente; la interfaz no es
la única barrera de autorización. El rol procede de `app_metadata`, administrado
en el servidor. La web está publicada en Vercel y consulta la API publicada.
También puede ejecutarse localmente en el puerto 3001.

Configura las variables públicas de `apps/web/.env.example` y ejecuta
`npm run dev:web`, o `npm run build:web` seguido de `npm run start:web`.
Consulta [el informe de integración](docs/admin-integration-20261007.md) para el
alcance terminado, las pruebas y las verificaciones manuales pendientes.

## Base de datos

Se recuperaron 21 migraciones de mayo, se reconciliaron cinco versiones de
septiembre y se registraron once cambios de piloto, campus y administración.
`npm run test:migrations` comprueba que esos 37 archivos conservan el SQL aplicado.
La auditoría y los ledgers están en `docs`; todavía faltan el esquema inicial
anterior a mayo y dos migraciones históricas de septiembre para reproducir toda
la base desde cero. Las fixtures de prueba no sustituyen una baseline productiva.
No realizar un `db push` ciego;
seguir la secuencia coordinada de la guía piloto y ensayar restauración en staging.
