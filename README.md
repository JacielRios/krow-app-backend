# KROW Platform

Monorepo de KROW. Contiene la API de negocio, el landing público y la base del
panel administrativo. La aplicación móvil continúa en el repositorio
`krow-app-mobile`.

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

`apps/api` y `apps/web` son aplicaciones independientes. Pueden desplegarse
como dos servicios en Railway o mantener la API en Railway y la web en Vercel.

## Requisitos

- Node.js 22 o 24.
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
npm run build
```

## API actual

La API valida tokens de Supabase Auth y expone perfiles, vehículos, viajes,
reservas, matching y Google Maps bajo `/v1`. Los flujos protegidos esperan
`Authorization: Bearer <supabase_access_token>`.

La configuración mínima incluye `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GOOGLE_MAPS_API_KEY` y `CORS_ORIGINS`. El backend no usa una `service_role`
para los flujos móviles actuales.

## Panel administrativo

La web contiene las pantallas base de dashboard, conductores, vehículos,
documentos, viajes y auditoría. El login permanece deshabilitado hasta
implementar en la API roles, permisos y auditoría. La interfaz nunca debe ser la
única barrera de autorización.

## Base de datos

La migración `supabase/migrations/202609130001_backend_foundation.sql` todavía
es una propuesta. Antes de aplicarla debe versionarse el esquema remoto real y
revisarse la seguridad de las funciones PostgreSQL existentes.
