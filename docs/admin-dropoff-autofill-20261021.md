# Autocompletado de paradas de solo descenso

Revisión del 21 de octubre de 2026. Reutiliza el mapa Google existente, los hooks administrativos, el servicio privado `GoogleMapsService`, el catálogo `transport_stops`, sus funciones transaccionales y los flujos móviles actuales. No instala dependencias adicionales.

## Datos generados

| Campo         | Fuente y criterio                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identificador | Prefijo común `krow-itnl-…` del catálogo de la avenida y sufijo `descenso` con huella de coordenadas. Se detectan identificadores ya existentes; la restricción única sigue siendo la autoridad ante concurrencia.                                                 |
| Nombre        | Nombre de la referencia seleccionada en Google; si no existe, vialidad y número/colonia de geocodificación. Sin esos datos se utiliza una etiqueta factual con coordenadas, que el administrador puede editar.                                                     |
| Dirección     | Geocodificación inversa del backend con su credencial privada. La clave web no recibe privilegios adicionales.                                                                                                                                                     |
| Municipio     | Componente explícito `administrative_area_level_2`; no se confunde automáticamente ciudad o colonia con municipio. Si falta, queda vacío con aviso.                                                                                                                |
| Sentido       | Etiqueta explícita de la referencia de autobús, por ejemplo `PTE - OTE`, o dirección registrada en el catálogo. Es una sugerencia operativa, no una garantía de circulación legal, lado de banqueta o seguridad; se solicita revisión. Sin evidencia, queda vacío. |
| Avenida       | Coincidencia normalizada con la vialidad estructurada o el nombre explícito de la referencia; se exige una única avenida activa. No se asigna solamente por cercanía.                                                                                              |
| Orden         | Proyección sobre la secuencia vigente de la avenida cuando hay al menos dos referencias, proximidad suficiente y no hay un punto casi coincidente ni un sentido explícito opuesto. En casos ambiguos, distantes o sin geometría suficiente queda manual.           |
| Coordenadas   | Punto original elegido en el mapa. La respuesta del geocodificador no desplaza la parada.                                                                                                                                                                          |
| Tipo          | Las nuevas altas administrativas se preparan como `dropoff_only`, “Solo descenso de pasajeros”. Los registros anteriores conservan su tipo.                                                                                                                        |

El administrador puede corregir los campos. La consulta se cancela/descarta cuando cambia el punto o se cierra el formulario; las respuestas tardías no sobrescriben campos editados. Los errores permiten captura manual y reintento. Una parada nueva activa requiere avenida; puede guardarse inactiva si falta confirmar esa vinculación.

## Persistencia y compatibilidad

`POST /admin/transport-stops/suggest` requiere sesión y autorización administrativas, reutiliza el límite de mapas y consulta catálogo y Google en paralelo. El guardado sigue pasando por `admin_upsert_transport_stop` y su auditoría.

La inserción ordenada es explícita en el formulario. Bloquea la avenida y desplaza sus posiciones activas posteriores en orden descendente dentro de la misma transacción. Un error revierte tanto el alta como los desplazamientos y las auditorías. Una huella de versión del catálogo detecta cambios concurrentes antes de insertar en una posición que ya no corresponde. Las ediciones anteriores mantienen su comportamiento, sin activar automáticamente esta opción.

La migración `20261021210626_dropoff_stop_automation.sql` amplía el tipo admitido, mantiene autorización y validaciones anteriores, excluye `dropoff_only` de descubrimiento/parejas/búsquedas de ascenso y agrega una protección en la escritura de reservas, incluidos clientes desactualizados. No cambia asignación de rutas, precios, asientos ni la selección explícita de descensos del conductor. No convierte masivamente los tipos ni renumera el catálogo al aplicar la migración.

Los viajes ya publicados conservan coordenadas, identificadores y orden de sus `ride_stops`. Las reservas existentes pueden continuar con sus cambios de estado. No se permite convertir en descenso la salida del ITNL ni una parada con ascensos comprometidos. Se mantienen las protecciones de desactivación con reservas pendientes.

La app móvil recibe las nuevas paradas dentro de las avenidas activas, los conductores las seleccionan al publicar y los pasajeros eligen su descenso entre los puntos efectivamente incluidos en el viaje. El panel de recorrido existente muestra esos descensos. Se amplía el tipo del contrato móvil y se rechaza defensivamente una respuesta que intente incluir un descenso exclusivo como ascenso. La protección efectiva está en API/base de datos y también aplica al APK ya instalado.

## Validación

- API: **30 suites, 211 pruebas**, incluyendo PostgreSQL nativo desechable; migración completa probada además en PGlite con referencias geográficas sintéticas.
- Web: **15 archivos, 87 pruebas**, incluyendo autocompletado, preservación de edición manual, cambio de coordenadas, respuesta tardía, reintento, alta inactiva y compatibilidad de edición existente.
- Contrato móvil: **22 pruebas**; TypeScript y lint de archivos modificados correctos.
- TypeScript API/web, lint API y compilaciones de producción correctos.
- **45 migraciones históricas** coinciden con sus ledgers; no se modificaron archivos ya aplicados.
- Comprobación de la nueva migración en Supabase con `ROLLBACK`: tipo nuevo válido y acceso anónimo al trigger denegado, sin cambios persistentes.
- Revisiones de seguridad antes y después del despliegue y prueba visual conectada se registran en las evidencias locales de la entrega.

Skills: Supabase, React best practices y despliegue/configuración Vercel. [Documentación oficial de geocodificación inversa](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-reverse-geocoding).

## Entrega y prueba conectada

La migración quedó aplicada en Supabase sin convertir ni agregar paradas. El catálogo conserva sus **22 registros**. Las revisiones de seguridad no incorporaron hallazgos respecto de la línea base.

El nuevo API se verificó en una instancia local con Google y el catálogo reales, la autenticación habitual y los trabajos de notificaciones desactivados: consulta autorizada 200, sugerencia 201, acceso anónimo 401, coordenadas inválidas 400 y catálogo sin cambios. El punto de la captura original generó identificador `krow-itnl-eloy-descenso-b0db190778`, nombre y dirección de la referencia, avenida Eloy Cavazos, sentido explícito Poniente a Oriente y orden sugerido 11. Google no entregó el municipio como componente explícito; se mantuvo vacío con un aviso.

En el navegador se seleccionó la referencia real GPE-0994 de Pablo Livas directamente en Google Maps y se comprobó el formulario autocompletado: identificador, nombre, dirección, sentido, avenida, orden 4 y coordenadas del marcador. Tipo fijo de alta: “Solo descenso de pasajeros”. El municipio quedó pendiente de confirmación. Se revisó el modal a ancho de teléfono, sin desbordamiento horizontal, y se canceló el borrador sin guardar.

Vercel compiló la versión de revisión `dpl_F15NvhBvsgWVKTSz6yMHCw4ByDL3` y pasaron las comprobaciones de siete páginas y trece recursos, incluidos los nuevos textos y la llamada de autocompletado. Esa versión sigue sin promover al dominio público.

**Bloqueo inicial, resuelto el 24 de octubre:** Railway rechazó inicialmente el envío del API con `Deploys have been paused temporarily`. Tras restablecer los despliegues, se publicó el API `ad6125bc-a876-4a4f-82d7-20ca3c98534b` con estado `SUCCESS` y se promovió el panel `dpl_ACrGFouFhHrrqsp3WJ6AfiHkiMdb` al dominio público. El endpoint administrativo pasó las comprobaciones conectadas en producción: consulta 200, sugerencia 201, acceso anónimo 401, coordenadas inválidas 400 y catálogo de 22 paradas sin cambios. [Registro final de publicación](release-20261024.md).
