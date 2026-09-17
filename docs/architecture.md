# Arquitectura de KROW

Este repositorio contiene dos aplicaciones desplegables e independientes:

- `apps/api`: API NestJS y autoridad de las reglas de negocio.
- `apps/web`: landing público y panel administrativo en Next.js.

Los paquetes de `packages/` comparten contratos y acceso HTTP sin acoplar la
interfaz a la persistencia. Supabase continúa alojando Auth, PostgreSQL y
Storage, pero las interfaces cliente consumen la API para operaciones de
negocio.

## Despliegue

Aunque ambas aplicaciones viven en el mismo repositorio, deben desplegarse como
servicios separados. Railway puede ejecutar ambos servicios; también es posible
mantener la API en Railway y mover únicamente la web a Vercel.

Dominios objetivo:

- `api.krow.mx`: `apps/api`.
- `www.krow.mx`: `apps/web`.
- `/admin`: área protegida dentro de `apps/web`.

## Límites actuales

La interfaz web es una base navegable. El formulario de login está deshabilitado
hasta implementar roles, permisos y el guard administrativo en la API. No debe
habilitarse únicamente mediante validaciones del navegador.
