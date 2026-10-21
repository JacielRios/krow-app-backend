# KROW: etapas 2–3 de cumplimiento

Fecha: 20 de octubre de 2026. El usuario aprobó el dominio web actual y limitó la preparación a **Android**. Se mantuvieron los cambios previos de ambos árboles de trabajo, React Query y las tecnologías existentes. No se añadieron dependencias de aplicación ni migraciones en estas etapas.

## Resultados

| Área | Resultado | Estado de aceptación |
| --- | --- | --- |
| Filtros de fechas | Selección opcional desde/hasta, validación, UTC, refresco y descarte de respuestas antiguas. Incluido en APK 0.5.2. | Pruebas móviles, SQL aislado y compatibilidad HTTP aprobadas; falta uso visual real. |
| Enlaces HTTPS | Asociación Android y páginas `/rides/{UUID}` y `/auth/callback` publicadas en el dominio aprobado. Navegación pendiente espera login y acceso de conductor. | Asociación HTTP pública, web y lógica móvil verificadas; falta verificación del SO en un teléfono y confirmación de redirect en Supabase. |
| Consulta parcial sin conexión | Perfil y primera página de listas propias, hasta 30 resúmenes por rol/grupo, almacenamiento protegido por cuenta y API, lectura por 24 horas y revalidación. | Pruebas automatizadas aprobadas; falta modo avión real. No es navegación o escritura offline. |
| Firebase Android | Guía específica, importación/validación del JSON público durante build y rechazo de claves de servidor. | Cuatro comprobaciones sintéticas aprobaron; el usuario todavía no tiene proyecto Firebase. Push permanece desactivado. |
| Entrega técnica | Arquitectura actualizada, guías, evidencias y APK versionado. | Ninguna actividad académica completa se declara terminada por estos cambios parciales. |

## Evidencia ejecutada

- **Móvil:** 237 pruebas aprobadas, 38 suites. TypeScript y ESLint aprobaron.
- **Web:** 55 pruebas aprobadas, 12 archivos; compilación Next.js y TypeScript aprobados.
- **Fechas SQL:** 14 pruebas aprobadas en la suite aislada de avenidas/búsqueda, incluidas las verificaciones de extremos opcionales e inclusivos. [Compatibilidad HTTP](search-dates-http-20261020.json): cinco comprobaciones aprobadas; los resultados válidos fueron listas vacías.
- **Firebase/build:** cuatro comprobaciones con fixtures sintéticas: configuración pública válida, restauración del entorno, rechazo de una cuenta de servicio y rechazo de otro paquete. No se contactó FCM ni se entregaron notificaciones reales.
- **Web publicada:** cinco comprobaciones HTTP públicas aprobadas, incluida asociación JSON 200 sin credenciales, auth 200 con no-store/no-referrer, viaje válido 200, UUID inválido 404 y login administrativo 200. [Evidencia](mobile-links-public-20261020.json).
- **APK:** `0.5.2-trial`, código 9, ARM64/ARMv7, firma de prueba existente, Hermes, sin depuración ni HTTP claro. SHA-256: `0F69224036D72C217288AFAACA5AB2E042D4BC7210B91E15CBF4D803D412D588`. El manifest contiene el dominio aprobado y las rutas `/rides/` y `/auth/`.
- **Dispositivos:** ADB sigue sin detectar equipos. No se instaló el APK ni se verificó GPS físico.

Vitest y el build web necesitaron ejecutarse fuera del sandbox por restricciones de sus archivos temporales/directorios generados; las ejecuciones finales aprobaron. No se modificaron pruebas para ocultar esos errores.

## Publicación web

Vercel: proyecto existente `krow-web`, despliegue `dpl_2ZpcGXJnHMaf9VkccHFDPuAvqGyM`. Se revisó el conjunto de 120 archivos antes de subirlo, excluyendo entornos, credenciales, datos temporales y fuentes de API. Primero se preparó sin cambiar el dominio; tras verificar la asociación y las páginas se promovió a `https://krow-web-gamma.vercel.app`. La inspección y las peticiones protegidas siguieron las guías de despliegue/acceso de Vercel, sin desactivar la protección del despliegue preparado.

La página de respaldo se inspeccionó en navegador y ofrece apertura explícita del paquete existente. No revela datos de viaje, no consume códigos de acceso en el navegador y no instala ni distribuye el APK.

## Acciones necesarias

1. **Firebase, usuario:** seguir la guía `docs/firebase-android-setup.md` del repositorio móvil. Crear el proyecto, registrar `com.krownmobileapp`, descargar `google-services.json` y guardar fuera del repositorio el JSON privado de la cuenta de servicio. Facilitar ID y rutas locales, sin pegar claves en el chat. Después configurar secretos del servidor, compilar y validar entrega FCM real.
2. **Supabase Auth:** añadir o confirmar en Redirect URLs `https://krow-web-gamma.vercel.app/auth/callback`. El panel observado requiere login y el conector no expone ese ajuste. Se conservarán Site URL y entradas existentes. No se enviaron emails ni se declaró probado el recorrido real de recuperación/confirmación. [Guía de enlaces](mobile-links-android-20261020.md).
3. **Railway:** desplegar la API de idempotencia preparada cuando se levante la incidencia global. La [página de estado](https://status.railway.com/) indica que las compilaciones están pausadas para todos los workspaces; los servicios existentes no están afectados. No se cambiaron planes ni se repitieron intentos durante esta etapa. El cliente nuevo sigue retenido porque la API anterior rechaza `requestId`.
4. **Android físico:** después del despliegue compatible, instalar el APK, verificar App Links con el SO, recuperación de acceso, modo avión/restablecimiento, aislamiento al cambiar de cuenta y recorrido GPS con dos participantes. Push se acepta solo con Firebase real y su configuración completa.

## Pendientes restantes

Recurrencia, modelo funcional de invitaciones y enlaces independientes de reserva siguen pendientes. La consulta parcial no permite buscar nuevos viajes, mapas descargados, chat, cobros ni modificaciones sin conexión. iOS queda fuera de esta etapa por decisión del usuario. El lanzamiento público, firma de distribución y validación académica integral siguen requiriendo trabajo y evidencias.

Referencias de implementación móvil: `src/core/offline/readOnlyCache.ts`, `src/features/pilot/readOnlyQueries.ts`, `src/features/pilot/ActivityScreen.tsx`, `src/features/home/hooks/useCurrentUserRole.ts`, `src/core/api/apiClient.ts`, `src/app/navigation/RootNavigator.tsx` y `scripts/build-android-trial.ps1`. Las guías `docs/offline-readonly.md` y `docs/firebase-android-setup.md` pertenecen al repositorio móvil.
