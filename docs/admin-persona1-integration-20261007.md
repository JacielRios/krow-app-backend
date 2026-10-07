# Administración de conductores, vehículos y viajes — 7 de octubre de 2026

## Estado auditado antes de los cambios

La base remota ya contiene las entidades de negocio utilizadas por React Native:
`users`, `driver_profiles`, `vehicles`, `rides`, `ride_stops`, `bookings`,
`ride_status_history`, `krow_pilot.booking_prices` y `krow_pilot.cash`.
Los perfiles de conductor usan `status` con los valores
`pending/approved/rejected/suspended`; no existe `approval_status`.
Los vehículos usan `license_plate`, `car_year`, `car_color` e `is_active`.
No había tablas de documentos, auditoría administrativa ni buckets Storage.

Existían `SupabaseAuthGuard`, `AdminGuard` y una conexión PostgreSQL limitada
`PilotDatabase`. El guard de autenticación consulta `auth.getUser(token)` en
cada petición. Se reutilizan esas piezas; no se añade una autenticación paralela
ni se entrega una clave `service_role` al navegador.

## Implementación

La API incorpora `AdminModule` y rutas bajo `/v1/admin`:

| Recurso | Operaciones |
| --- | --- |
| `me` | Verifica una sesión administrativa vigente. |
| `users` | Busca cuentas registradas para asociar un conductor. |
| `drivers` | Lista/busca, crea para una cuenta existente, consulta detalle, edita datos y cambia estado. |
| `vehicles` | Lista/busca, registra por conductor, edita y desactiva sin eliminar viajes. |
| `documents` | Lista, prepara carga privada, verifica el archivo cargado, revisa y genera descarga temporal. |
| `rides` | Historia paginada y detalle con conductor, pasajeros, paradas, ruta, horarios y efectivo. |
| `audit` | Consulta los cambios de conductores, vehículos y documentos con actor y fecha. |

Las listas devuelven `{items,total,page,pageSize}` y los campos usan camelCase.
Los identificadores son UUID. Los filtros `q`, conductor, estado y fechas se
ejecutan en PostgreSQL antes de paginar; el máximo de página es 100. Las fechas
sin hora representan días completos en `America/Monterrey`; el día final se
incluye. Una fecha ISO con zona horaria conserva su instante explícito.
Los importes del historial se expresan en centavos y proceden del precio
comprometido de la reserva y del registro de efectivo, no de cifras de ejemplo.
No hay pagos electrónicos ni pagos inferidos como cobrados.

### Compatibilidad con la app móvil

`driver_profiles.admin_status` expresa `active/suspended/inactive` sin cerrar la
cuenta del pasajero. Activar requiere licencia vigente y mantiene `status=approved`;
suspender mantiene `status=suspended`; desactivar usa `status=pending`.
Los controles existentes de publicación e inicio ya requieren `approved`.
Los vehículos mantienen `is_active=true` únicamente con estado activo. Su baja
es lógica; no elimina reservas o historia. No se modifica un viaje activo ni
se interrumpe su seguimiento GPS al suspender un conductor o vehículo.
Reducir la capacidad por debajo de los asientos comprometidos de viajes
pendientes produce un conflicto.

La documentación faltante o vencida se identifica en `compliance.state/reasons`.
Se informa al administrador sin imponer automáticamente una nueva restricción
documental a los conductores existentes del piloto. Se conservan las reglas
anteriores de negocio y las entidades originales; no se crea otra tabla de viajes.
La ruta histórica recupera la última versión de las paradas, ya que la versión
de concurrencia del viaje también aumenta al iniciar y finalizar.

## Migración y seguridad

`supabase/migrations/20261007170120_admin_management.sql` es aditiva:

- Añade estado administrativo y lo deriva del estado existente, conservando datos.
- Añade `krow_admin.documents` y `krow_admin.audit_log` con RLS e índices.
- Añade un bucket privado `krow-admin-documents`, limitado a PDF/JPEG/PNG de 10 MiB.
- Concede permisos de escritura limitados al rol privado existente de la API.
- Mantiene sin INSERT/UPDATE de conductores y vehículos al cliente autenticado.
- No concede lectura de `auth.users` al runtime, ni UPDATE/DELETE de auditoría.

`private.is_admin_actor()` verifica el rol actual en `auth.users.raw_app_meta_data`
y exige perfil público disponible. Toma únicamente `auth.uid()`, no una identidad
aportada por el cliente. La función tiene `search_path` vacío, no está en el esquema
expuesto y su ejecución se limita a authenticated/runtime para Storage y API.
La transacción administrativa fija el actor y vuelve a verificar esa condición.
Por ello, un JWT antiguo después de retirar el rol no conserva acceso al módulo.
`user_metadata.role` no otorga permisos.

Los archivos usan rutas UUID inmutables; un documento nuevo obtiene una ruta
nueva. La aprobación exige carga comprobada, tamaño/formato coincidentes y vigencia.
La descarga firmada expira en 60 segundos. El token de carga de Supabase expira
en dos horas según su contrato; no se escribe en auditoría ni en logs.
No se incluyen rutas privadas, claves, tokens o contraseñas en los cambios auditados.
Una modificación y su registro administrativo comparten transacción.

La creación de un conductor asocia una cuenta que ya se registró en KROW. La API
no crea contraseñas ni cambia roles Auth desde un formulario público. El alta de
administradores se hace explícitamente mediante la cuenta autorizada y
`app_metadata` administrada en Supabase.

## Verificación

Se verificó TypeScript y se ejecutaron 21 pruebas administrativas locales con
PostgreSQL embebido y datos sintéticos. Cubren autorización, rol falsificado,
metadata desactualizada, cuenta desactivada/ausente, permisos mínimos y RLS,
duplicados, rollback de auditoría, estados y conservación de cuenta pasajero,
capacidad comprometida, carga privada y aprobación documental, historial con
centavos, participantes, horas reales, ruta tras cambiar la versión del viaje,
paginación, SQL parametrizado, límites por día local, zona horaria de vigencia
y permisos de lectura del catálogo por columna.

La prueba del detalle contra el runtime real detectó un permiso faltante de
lectura de `transport_stops` (SQL 42501), ocultado por una concesión general en
la fixture sintética. `20261007171623_admin_route_catalog_read.sql` concede solo
SELECT de `stop_id/name` a la API privada y una política RLS administrativa.
La fixture ahora enumera los permisos de producción y prueba ese permiso mínimo.
No se alteraron los permisos públicos ni la migración previamente aplicada.

La fixture `apps/api/test/admin-baseline.sql` sirve exclusivamente para pruebas;
no reemplaza el esquema remoto ni es una migración de producción. Los contratos
del cliente Storage se contrastaron con el SDK instalado: `info()` devuelve
`contentType` en camelCase.

La aplicación y verificación de la migración remota, prueba de login administrativo
real y despliegue del conjunto se registran en el informe general de integración.
