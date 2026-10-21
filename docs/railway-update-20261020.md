# Actualización de la API en Railway

Fecha: 20 de octubre de 2026. El usuario pidió comprobar la disponibilidad de Railway y subir la actualización pendiente si era posible.

## Publicación completada

- Despliegue **`5d625538-76ab-4961-890d-493a72978442`**, estado **SUCCESS**, confirmado el **20 de octubre a las 15:05:46, hora de Ciudad de México** (`2026-10-20T21:05:46Z`).
- Proyecto existente `krow-api-pilot`, servicio `krow-api`, entorno `production`, una réplica. Sin cambio de plan, facturación, base de datos ni flags push.
- API: `https://krow-api-production.up.railway.app/v1`.
- Publicación desde el árbol local con cambios sin commit, base `6b28829f224f7a70b28a2da329e5f765ad206eac`. `railway up` utilizó explícitamente los IDs del servicio/entorno/proyecto existentes; un redeploy de la imagen anterior no habría incluido las fuentes nuevas.
- Imagen Linux: `sha256:598e72006f88165d5b61f0537b3c8a5b86eb6702df270af25af80535d3b17881`.

## Preparación y verificación

1. Railway informó estado operativo y aceptó la subida. Antes del despliegue se comprobó que había **cero viajes en curso**.
2. Compilación local de la API y TypeScript aprobaron. Se revisaron `Dockerfile.api`, healthcheck, puerto y exclusiones. La enumeración de candidatos de subida con las reglas de ignore encontró 323 archivos, 1926641 bytes y cero candidatos sensibles; es una revisión local del conjunto, no una medición del archivo comprimido transferido.
3. El build remoto completó instalación, compilación NestJS, imagen y arranque. No se alteraron dependencias para resolver avisos del tooling.
4. **Once comprobaciones HTTP aprobaron:** health 200; readiness 200 con `pilot: ready`; protección 401 de perfil/publicación sin JWT; perfil y catálogo con JWT 200; aceptación del `requestId` nuevo y consulta SQL privada; rechazo del UUID inválido; rechazo de campos desconocidos; búsqueda futura y rechazo del rango invertido.
5. La prueba de contrato envió un UUID v4 nuevo con paradas vacías. La API alcanzó `get_ride_publication` y luego devolvió el error esperado de selección de paradas. Esto confirma DTO → servicio → consulta SQL sin publicar datos ni llamar Maps. No constituye una prueba HTTP de creación positiva ni de repetición exitosa de un viaje; esos aspectos se habían cubierto con pruebas aisladas de servicio/PostgreSQL.
6. El primer comprobador HTTP esperaba una lista de mensajes de validación; el filtro existente devuelve una cadena. Se corrigió solamente el comprobador y la ejecución final aprobó todas las comprobaciones.
7. El transporte **Engine.IO v4 sobre WebSocket** abrió correctamente. No se ingresó a un viaje ni se enviaron posiciones. Seguimiento autenticado y GPS físico siguen sin probarse en esta publicación.
8. Los conteos globales antes y después se mantuvieron en **55 viajes, 37 reservas y cero recibos de publicación**. No se crearon viajes, reservas ni notificaciones; no se aplicaron migraciones en esta etapa.

Evidencias: [HTTP](railway-update-http-20261020.json), [WebSocket](railway-update-websocket-20261020.json) y [resumen estructurado](railway-update-20261020.json).

## Estado para Android

Se elimina el bloqueo causado por la API antigua que rechazaba `requestId`. El APK privado **0.5.3-trial** puede iniciar aceptación en dispositivos con cuentas existentes; no requiere recompilarse por esta publicación, pues mantiene el mismo dominio y contrato previsto.

Permanecen pendientes la aceptación física, enlaces reales de autenticación/recuperación y comprobación de su allowlist en Supabase, mapas/GPS con dos participantes y recepción de push. Los flags push permanecen en `false` en backend y móvil; configurar Firebase no equivale a activar ni verificar notificaciones. La firma del APK sigue siendo de prueba privada.
