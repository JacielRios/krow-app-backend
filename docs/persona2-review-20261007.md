# Revisión e integración de Persona 2 — 7 de octubre de 2026

Se revisaron los commits `a414d0c` (Alexa Avila) y `6bb3cdb` antes de adaptar sus archivos. Se conservaron los componentes, imágenes, secciones de la landing, identidad visual y gráficas Recharts. La integración mantiene Next 16.3.6 y la arquitectura de autenticación administrativa del proyecto actual.

| Requerimiento | Estado recibido | Integración realizada |
| --- | --- | --- |
| Estructura administrativa | Parcial: sidebar propia en un dashboard público, además del layout admin ya existente. | Dashboard dentro del shell administrativo compartido, sin una segunda navegación. |
| Dashboard principal | Parcial: generador `getMockData` activo; conexión API comentada. | Consulta autenticada real, actualización, carga, error y reintento. El generador queda aislado del producto. |
| Realizados, cancelados y en curso | Tarjetas y gráficas diseñadas; cifras ficticias. | Valores del endpoint existente `/v1/reports/dashboard-summary`; añadido estado programado. |
| Conductores activos/inactivos | Tarjetas diseñadas; cifras fijas. | Estado actual del catálogo; aclaración de que no depende del rango de viajes. |
| Pasajeros y ocupación | Vista existente; cálculo del backend incompatible con asientos disponibles y estados. | Pasajeros abordados/completados y ocupación ponderada del contrato corregido por backend. |
| Finanzas | Datos aleatorios; el backend devolvía estimación redondeada y cobros nulos. | Importes comprometidos, efectivo recibido y pendiente; centavos conservados. No se etiquetan reservas como ingresos netos de KROW. |
| Rutas con mayor actividad | Tabla existente con rutas ficticias. | Tabla de rutas reales, encabezados accesibles y vacío explícito. |
| Filtro por fecha | Selección existente aplicada al generador local. | API filtrada por fechas de Monterrey; solicitudes anteriores canceladas al cambiar el periodo. |
| Gráficas y tarjetas | Diseño Recharts existente. | Reutilizado, corregidos tipos de Tooltip de Recharts 3; formato MXN consistente. |
| Apoyo a decisiones | Textos con porcentajes calculados sobre muestras ficticias; fallo con cero viajes. | Resumen derivado de viajes y efectivo reales, sin divisiones por cero ni lectura de rutas inexistentes. |
| Landing pública | Secciones y recursos existentes. | Conservadas; alcance universitario Android/efectivo/GPS online coherente con la app actual. |
| Propuesta de valor | Incluía cifras inventadas y funciones no disponibles: tarjeta y compartir GPS con terceros. | Eliminadas esas afirmaciones; información basada en las funciones actuales. |
| Acceso administrativo | Enlace existente; dashboard público fuera del control de acceso. | Login administrativo visible. `/Dashboards` redirige a `/admin/dashboard`, que exige autorización. |
| Escritorio/tablet/móvil | Media queries presentes; foto sobredimensionada, estilos globales y menú oculto enfocable. | CSS limitado a `.landing` / `.dashboard`, imágenes acotadas, menú cerrado fuera del flujo y cuadrículas adaptables. |
| Pruebas | No existían pruebas de estas vistas. | Pruebas de indicadores, errores, vacíos, fechas, reintento, actualización, respuestas fuera de orden, landing y contacto. |

## Compatibilidad y problemas encontrados

- La URL del hook apuntaba al frontend local (`localhost:3001`) y carecía del prefijo real de API; ahora usa el cliente administrativo compartido con token de sesión actual.
- El dashboard público mostraba métricas económicas ficticias sin autenticación; la ruta antigua ahora solo redirige al área protegida.
- `dashboard.css` modificaba `body`, `section`, `table`, encabezados y variables de todo el sitio. Sus reglas y las de la landing quedaron limitadas a sus contenedores.
- `TerminosPage.tsx` importaba CSS desde `/Dev/krow-app-backend/...`, dependiente de otra computadora. Se sustituyeron esas rutas por imports del proyecto.
- `/registro` y `/terminos` estaban enlazados sin una página existente. Se retiraron las llamadas a registro web y se añadió una página informativa de términos.
- El formulario simulaba envío exitoso después de una espera y podía acceder a `event.currentTarget` nulo. Ahora genera un borrador de correo real solo cuando existe contacto configurado; conserva el mensaje hasta que el usuario lo envíe con su aplicación de correo.
- No se inventó un correo, aviso de privacidad ni plazos de retención: las páginas comunican su estado y pueden enlazar los documentos aprobados cuando se configuren.

## Configuración externa pendiente

Variables públicas opcionales en `apps/web/.env.example`: `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_URL`, `NEXT_PUBLIC_PRIVACY_URL`, `NEXT_PUBLIC_TERMS_URL` y `NEXT_PUBLIC_ANDROID_DOWNLOAD_URL`. Requieren datos aprobados por el equipo. Si no hay configuración, no se anuncia un envío exitoso, una descarga pública disponible ni una política aprobada.

La ampliación a empresas se presenta como posibilidad posterior al piloto; no como un servicio empresarial ya disponible.

## Verificación

`npm run typecheck --workspace @krow/web` aprobado. `npm run test:web` aprobó **39 pruebas en nueve suites: 23 de Persona 1 y 16 de Persona 2**. Las pruebas cubren estados reales y controles de interacción; las pruebas de NestJS/Supabase y la inspección visual se registran en el informe general de integración. Durante la primera ejecución, los procesos de pruebas perdieron archivos de caché temporal del sandbox; usar `TEMP` y `TMP` en `.tmp/vitest-temp` permitió completar la ejecución con todos los procesos dentro del espacio de trabajo.

Los cambios de esta sección son exclusivamente web. No se modificó la navegación ni los contratos que consume React Native.
