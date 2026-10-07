# Integración de repositorios, panel y dashboard — 7 de octubre de 2026

## Resultado

Se incorporaron los dos commits remotos de Alexa Ávila, `a414d0c` y `6bb3cdb`,
mediante avance directo de `master`. El backend quedó en `6bb3cdb`; el repositorio
móvil no tenía commits nuevos. Se conservaron el diseño y los recursos de la
landing y las gráficas del dashboard. El trabajo local previo de piloto, campus,
permisos y GPS se recuperó sin descartar archivos.

Antes de integrar se guardaron un stash, un parche binario y copias privadas en
`.tmp/admin-integration`. Los conflictos de `app.module.ts` y `package-lock.json`
se resolvieron conservando ReportsModule, PilotModule y las dependencias locales.
Las 98 rutas originalmente sin seguimiento siguen presentes. Las adaptaciones
del trabajo previo se limitaron a módulos, dependencias, scripts, configuración y
documentación; se conservó la implementación anterior del piloto.
No se hizo commit ni push del conjunto de cambios locales.

## Existente, adaptado y completado

| Área | Base existente | Resultado de esta integración |
| --- | --- | --- |
| Persona 1 · acceso | Guards de Supabase/administrador y pantallas base | Login funcional, sesión recuperable, comprobación `/admin/me`, shell protegido y permisos verificados por API y base. |
| Persona 1 · conductores | Usuarios y perfiles utilizados por la app móvil | Alta sobre cuenta registrada, consulta/edición de licencia y vigencia, estados activo/suspendido/inactivo, advertencias documentales y auditoría. |
| Persona 1 · vehículos | Vehículos y relación con conductor | Registro, edición y baja lógica; capacidad comprometida protegida y propietario histórico conservado. |
| Persona 1 · documentos | Pantalla base sin almacenamiento operativo | Bucket privado, PDF/JPEG/PNG hasta 10 MiB, carga firmada, comprobación de contenido, revisión/vigencia y descarga temporal. |
| Persona 1 · viajes | Viajes, reservas, paradas y efectivo del piloto | Filtros en servidor, paginación y detalle real con participantes, ruta, horarios, precios en centavos y cobros. |
| Persona 2 · dashboard | Diseño, gráficas y endpoint de reportes | Métricas SQL reales, fechas locales inclusivas, tendencias, rutas e insights; carga, vacío, error y actualización conservando contenido. |
| Persona 2 · landing | Diseño y recursos del repositorio remoto | Estilos aislados, acceso al panel, navegación adaptable y enlaces corregidos; eliminación de cifras y promesas ficticias. |

Los informes específicos describen los cambios de
[Persona 1 web](persona1-review-20261007.md),
[Persona 1 API](admin-persona1-integration-20261007.md) y
[Persona 2](persona2-review-20261007.md).

## Correcciones relevantes

- El dashboard público redirige al panel protegido; reportes requieren administrador.
- El rol se obtiene de `app_metadata` y se contrasta con el estado actual de Auth
  y del perfil público. Un rol escrito en `user_metadata` o un JWT antiguo no
  permiten eludir la autorización.
- Los agregados se calculan en PostgreSQL para evitar recortar resultados a la
  primera página de REST. La ocupación usa asientos disponibles más comprometidos.
- Se distinguen pasajeros transportados de reservas futuras, importe comprometido
  de efectivo cobrado y viajes cancelados de finalizados. `full` forma parte de
  los programados. Las fechas se interpretan en `America/Monterrey` y conservan centavos.
- El historial toma la última versión real de las paradas, independiente de los
  cambios de versión por inicio/finalización del viaje.
- La prueba real del detalle detectó SQL 42501 por lectura de `transport_stops`.
  Se añadió SELECT exclusivamente de `stop_id/name`, con RLS administrativa, y se
  corrigió la fixture que ocultaba el problema con permisos demasiado generales.
- Los modales tienen labels únicos, foco inicial en el formulario, cierre con Esc
  y retorno del foco. Se corrigieron enlaces públicos y se aisló CSS de la landing.
- El formulario de contacto ya no simula un envío exitoso. El soporte y las URLs
  legales se configuran cuando exista contenido aprobado.

## Nest, Supabase y despliegue

Se reutilizaron SupabaseAuthGuard, AdminGuard y la conexión PostgreSQL limitada
del piloto. Los nuevos endpoints están bajo `/v1/admin`; se mantiene
`/v1/reports/dashboard-summary`. La web utiliza únicamente URL y clave pública
Supabase más la URL de API; no recibe contraseña de base ni `service_role`.

En el proyecto Supabase `yyjbqzsokxpzhevpanyq` se aplicaron y se verificaron:

1. `20261007170120_admin_management`: estados compatibles con el negocio actual,
   documentos y auditoría privados, índices, RLS y bucket `krow-admin-documents`.
2. `20261007171623_admin_route_catalog_read`: lectura limitada del catálogo para
   el detalle administrativo.

Antes y después se conservaron 50 viajes, 34 reservas, un conductor y un vehículo.
El rol privado sigue sin poder leer directamente `auth.users`; el cliente anónimo
no puede invocar la comprobación administrativa. Las verificaciones de escritura
administrativa usaron transacciones revertidas y no cargaron archivos reales.

La API está publicada en
[Railway](https://krow-api-production.up.railway.app/v1/health/ready).
Despliegue final `ab5a9622-db44-4751-ab96-3ded384b7150`, estado `SUCCESS`.
Se reutilizó el servicio existente y no se seleccionó otro plan ni se crearon
recursos nuevos. CORS permite `http://localhost:3001` y `http://localhost:8081`.
Durante la verificación inicial la web era local. Posteriormente se publicó en
[Vercel](https://krow-web-gamma.vercel.app/admin/login), con CORS y login reales
verificados; consulta [la publicación](web-hosting.md).

Se creó la cuenta solicitada `krowteam64@gmail.com` y se asignó el rol administrativo
en el servidor. Su contraseña aleatoria está únicamente en el archivo local
ignorado `.tmp/admin-integration/admin-access.txt`; es independiente de Gmail y no
se incluye en este informe ni en el repositorio.

## Compatibilidad móvil

Esta integración administrativa no modificó React Native ni requiere un APK nuevo.
Los estados administrativos se traducen a `status` e `is_active` existentes. La
baja conserva datos históricos y el modo pasajero; no corta un seguimiento GPS en
curso. La falta de nuevos documentos se informa sin bloquear automáticamente a
los conductores ya aprobados. Se mantuvieron los cambios previos de origen ITNL,
paradas, teclado, mapas y piloto.

## Verificación realizada

| Comprobación | Resultado |
| --- | --- |
| API · Jest | 137 pruebas aprobadas, 22 suites; 13 pruebas de dos suites con PostgreSQL externo omitidas. |
| E2E HTTP | 6 pruebas aprobadas, 2 suites: health y contratos principales del piloto. |
| Web | 39 pruebas aprobadas, 9 suites: 23 de Persona 1 y 16 de Persona 2. |
| Móvil | 147 pruebas aprobadas, 27 suites; TypeScript aprobado. |
| Tipos y compilación | Workspaces comprobados; Nest y Next compilaron. Next generó 17 rutas. |
| Lint API y diff | Aprobados. |
| Importación de paradas | 6 pruebas aprobadas. |
| Ledger SQL | 37 migraciones recuperadas coinciden con el SQL aplicado. |
| API real publicada | 15 comprobaciones aprobadas, incluidos login, listas, detalle, dashboard, rechazo anónimo, fechas inválidas y CORS. |
| Permisos reales y Storage | 6 comprobaciones aprobadas; transacción revertida y URL de carga firmada aceptada. |
| Dependencias | Auditoría de producción y web sin vulnerabilidades informadas. |

Evidencias reproducibles sin secretos:
[API publicada](admin-live-checks-20261007.json),
[permisos y Storage](admin-live-permissions-20261007.json) y
[resumen](admin-integration-evidence-20261007.json).

En navegador se comprobó el login real con la cuenta autorizada, métricas reales,
navegación móvil, formulario de conductor y recuperación del foco. La inspección
visual contempla tamaños móvil, tablet y escritorio. No se guardaron cambios en
conductores, vehículos o viajes reales durante esas comprobaciones.

## Pendientes concretos

1. Publicación web completada posteriormente: [KROW en Vercel](https://krow-web-gamma.vercel.app).
   El dominio ya está permitido en el CORS de Railway. Consulta
   [la evidencia de esta publicación](web-hosting.md).
2. Probar un ciclo completo de carga y descarga de archivo real y el rechazo en
   navegador de una cuenta normal con credenciales disponibles. Hay cobertura
   automática de esos permisos y validación real de la firma de carga.
3. Ejecutar las 13 pruebas que requieren PostgreSQL externo en un entorno de
   pruebas aislado; las suites embebidas y la conexión real limitada ya aprobaron.
4. Completar soporte, aviso de privacidad, términos y retención con contenido
   aprobado. No se inventaron contactos, políticas ni cifras de adopción.
5. Recuperar el esquema inicial y dos migraciones históricas de septiembre para
   restaurar toda la base desde cero; las fixtures no son esa baseline.
6. Resolver 35 avisos de dependencias de desarrollo heredadas (25 moderados,
   10 altos) con actualizaciones compatibles de Nest CLI/Jest/ESLint. No se aplicó
   `npm audit fix --force`; producción y web no presentan avisos.
7. Revisar advertencias previas de funciones públicas SECURITY DEFINER y activar
   protección Auth de contraseñas filtradas si corresponde al entorno. No se
   ampliaron permisos públicos para resolver errores administrativos.
8. Actualizar la configuración Railway deprecada antes del 1 de diciembre de 2026.
   Su despliegue actual funciona. La validación física GPS/Android del piloto
   sigue siendo una tarea distinta de esta integración web.
