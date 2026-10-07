# Persona 1 — revisión e integración administrativa

Fecha: 7 de octubre de 2026. Revisión del árbol integrado desde `origin/master` (`6bb3cdb`) y adaptación a la API actual de KROW.

## Estado encontrado y resultado

| Requisito | Estado en el repositorio integrado | Implementación final de frontend |
|---|---|---|
| Login administrativo | Formulario deshabilitado y mensaje de próxima implementación | Correo/contraseña con Supabase Auth, sesión persistente, contraseña visible opcional y errores recuperables. No existe registro público de administradores. |
| Roles y permisos | Layout accesible sin comprobación de permisos | El contenido se monta después de que `/v1/admin/me` verifique la identidad y autoridad actuales. Todas las consultas y cambios usan Bearer y el backend vuelve a comprobar los permisos. El frontend no confía en `user_metadata`. |
| Estructura administrativa | Sidebar básica, oculta por completo en pantallas pequeñas | Se conserva el layout de la plataforma y se incorpora menú móvil, estado de navegación, acceso directo al contenido, cierre de sesión y recuperación de sesión/acceso. El dashboard de Persona 2 usa el mismo proveedor. |
| Alta y consulta de conductores | Página descriptiva sin datos | Alta del perfil de conductor sobre una cuenta KROW ya registrada, búsqueda, estados, paginación de servidor, licencia y vigencia, detalle de vehículos/documentos y enlaces al historial. |
| Edición y activación/suspensión/desactivación | Sin formulario ni acciones | Edición de nombre/licencia; cambio de estado confirmado y motivo obligatorio para retirar acceso operativo. Se mantienen separados estado operativo y aprobación del modelo móvil. |
| Vehículos asociados | Página descriptiva | Registro y edición con validación de placas, marca, modelo, año, color y capacidad; filtros por conductor/estado; avisos de documentación; confirmación al suspender/desactivar. La edición conserva el propietario para no reasignar viajes históricos. |
| Documentación y vigencia | Página descriptiva | PDF/JPG/PNG privados hasta 10 MB, carga firmada, confirmación de recepción, observaciones y revisión, filtros de vigencia/estado y enlace firmado de lectura de 60 segundos. Una carga pendiente no se puede aprobar. |
| Historial completo de viajes | Página descriptiva | Paginación de servidor y búsqueda por ID/conductor/destino; filtros de conductor, fechas y estado; detalles con conductor, vehículo, pasajeros, puntos de subida/bajada, horarios, estado, precio en centavos, efectivo e historial. |
| Visualización de ruta | Sin vista administrativa | Esquema geográfico de la geometría persistida, paradas y enlace al origen/destino en Google Maps. Una geometría incompleta o excesiva produce una vista por los puntos disponibles; no inventa un recorrido. |
| Auditoría | Página descriptiva | Lista paginada de cambios de conductor/vehículo/documento con administrador, fecha, entidad y valores anteriores/posteriores. |
| Pruebas | Sin pruebas de estos módulos | Regresiones de acceso, login ordinario rechazado, paginación, suspensión confirmada, alta sin rol administrativo, contrato PATCH de vehículos, carga privada/reintento y respuesta antigua descartada. |

## Arquitectura y contratos

- Se mantienen App Router y los estilos existentes. El CSS adicional se limita a la administración; no cambia la landing ni la aplicación móvil.
- `apps/web/src/lib/admin-auth.tsx` mantiene la sesión de Supabase y verifica acceso con la API. `admin-supabase.ts` usa únicamente URL y clave pública; no contiene credenciales privadas ni servicio administrativo de Auth.
- `apps/web/src/lib/admin-api.ts` centraliza autorización, expiración/revocación, errores y cancelación de consultas. Se conserva el contenido durante actualizaciones y se descartan respuestas de filtros anteriores.
- Los listados reciben `{ items, total, page, pageSize }`. Conductores, vehículos y documentos usan los contratos reales del módulo NestJS `/v1/admin`; el dashboard conserva `/v1/reports/dashboard-summary`.
- Campos y límites de formularios se contrastaron con los DTO de NestJS. Se corrigió la incompatibilidad inicial del PATCH de vehículos: `driverId` se envía en el alta y se omite en edición, donde el backend no permite cambiarlo.
- Las fechas visibles del viaje se presentan en `America/Monterrey`. Se notificó al responsable del backend que los filtros de fecha sin hora deben usar esa zona; la consulta se adaptó para no cortar los viajes nocturnos por medianoche UTC.
- El backend aplica permisos y persistencia. Ocultar el panel en el cliente mejora la experiencia, pero no es la frontera de seguridad.
- Documentos: el backend prepara el registro y token limitado; el navegador carga al bucket privado y confirma el archivo. Si falla la confirmación, se reintenta sobre el mismo registro sin volver a cargar ni crear duplicados. El enlace firmado se retira de la interfaz antes de su caducidad.

## Accesibilidad y revisión React

Se revisaron etiquetas, navegación con teclado, estados de carga, mensajes, cierre de sesión, acciones y modales. Los diálogos usan el elemento nativo `dialog`, título único, foco inicial en el formulario, restauración del control que lo abrió y Escape fuera de operaciones pendientes. Los listados mantienen filtros/paginación y tablas desplazables en pantallas pequeñas. Se respetan movimiento reducido y foco visible. Las llamadas por fila se realizan al consultar detalles, no al renderizar cada fila.

No se añadieron Redux, un segundo SDK de autenticación, SSR con secretos, otra capa de permisos ni endpoints móviles duplicados.

## Evidencia automática

- `npm run typecheck --workspace @krow/web`: aprobado.
- `npm run test:web`: **39 pruebas aprobadas, 9 suites**. Persona 1 aporta 23 y Persona 2 aporta 16.
- El build web se verificó en el bloque de integración; el resultado final y las pruebas de API, PostgreSQL, despliegue y navegador se registran en el informe general del proyecto.
- En Windows, la ejecución de Vitest se realizó con `TEMP` y `TMP` dentro de `.tmp/vitest-temp` para evitar archivos de transformación inaccesibles en el directorio temporal del sandbox.

## Validación de la integración

- Supabase: aplicadas `admin_management` (`20261007170120`) y `admin_route_catalog_read` (`20261007171623`); bucket de documentación privado y permisos integrados.
- Cuenta administrativa autorizada: `krowteam64@gmail.com`. Los datos de acceso se guardaron únicamente en el archivo local privado `.tmp/admin-integration/admin-access.txt`, fuera del repositorio y del frontend.
- Railway: despliegue `ab5a9622-db44-4751-ab96-3ded384b7150` en estado **SUCCESS**.
- Las 15 comprobaciones contra la API publicada aprobaron. Se comprobó CORS para el panel local en `http://localhost:3001`.
- Login real en navegador y dashboard con datos de la API publicados comprobados. En esta primera verificación el panel era local; la publicación posterior en Vercel se registra en [web-hosting.md](web-hosting.md).

## Validaciones y condiciones pendientes reales

Quedan la carga y descarga completas de un archivo real desde el navegador y la prueba de acceso con credenciales propias de un usuario no administrador. La autorización negativa ya tiene cobertura automática; falta ese ensayo con una sesión real de usuario ordinario en el navegador. La publicación web se completó después de la integración en [Vercel](https://krow-web-gamma.vercel.app), con login, dashboard y CORS verificados; véase [la evidencia](web-hosting.md).

El alta de un conductor requiere que la persona ya tenga una cuenta KROW. Se indica en el formulario y evita crear usuarios administrativos o contraseñas desde este módulo. La vista de ruta es un esquema de consulta histórica; no ofrece navegación del vehículo ni sustituye el seguimiento GPS móvil.

El contacto, aviso de privacidad y políticas de retención siguen dependiendo de contenido operativo aprobado. No se generan políticas, contactos ni confirmaciones de envío ficticios en la administración.
