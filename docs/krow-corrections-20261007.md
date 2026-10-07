# KROW: origen ITNL, paradas y estabilidad de «Ver ruta»

La revisión comenzó por el cierre reportado después de pulsar «Ver ruta», antes de observar movimiento. Se encontraron y corrigieron condiciones capaces de fallar al cargar el mapa y procesar GPS. No hubo un registro del cierre del teléfono, por lo que falta confirmar el incidente original en el dispositivo.

## Cambios entregados

- Nuevas publicaciones y favoritas parten del **Instituto Tecnológico de Nuevo León**, sin selector de origen. La API impone esa salida al crear; al editar conserva la salida registrada del viaje. Los viajes existentes conservan sus coordenadas reales.
- Búsquedas restringidas a viajes del Instituto antes de aplicar el límite de resultados. El pasajero puede usar «Subir en otra parada»; la salida del recorrido sigue siendo el Instituto y la parada de subida puede ser intermedia.
- **14 referencias nuevas**: cinco en Eloy Cavazos, cinco en Pablo Livas y cuatro en Avenida a Reynosa. Se conservaron los tres puntos existentes frente al ITNL y se sustituyeron los nombres «Parada 1–3» por referencias claras. Catálogo activo: **17 puntos**.
- Selección de paradas con números, direcciones, feedback y sincronización entre mapa/lista. Solo se ofrecen reservas en pares de paradas que un viaje disponible atiende en el orden correcto.
- Búsqueda por nombre con campo fijo, lista desplazable y resultados seleccionables con teclado abierto. La hoja adapta su espacio a Android/iOS y cancela las solicitudes al cerrarse.
- El mapa espera dimensiones y carga antes de ajustar cámara; limita padding, valida coordenadas y elimina animación imperativa concurrente del vehículo.
- Seguimiento valida datos REST/Socket incompletos. Android protege permisos, procesamiento del fix, construcción de JSON y limpieza. La navegación tiene recuperación ante errores JavaScript.
- Salir cancela un inicio GPS pendiente, sin cortar un servicio ya activo. Las creaciones de sesiones se ejecutan en orden para impedir que una solicitud anterior invalide el seguimiento al reabrir.

Los puntos del catálogo son referencias generales de encuentro KROW verificadas mediante geocodificación de intersecciones y direcciones públicas. Su señalización, banqueta, lado de circulación y posibilidad de detenerse requieren revisión en campo antes del piloto con usuarios reales; no se declararon zonas oficiales de transporte. [Datos y procedencia](data/itnl-corridor-stops-20261007.json), [CSV reutilizable](data/itnl-corridor-stops-20261007.csv). Dirección oficial del Instituto: [TecNM Nuevo León](https://nuevoleon.tecnm.mx/).

## APK para probar

`C:/Users/Novasys/Documents/krow-app-mobile/artifacts/android/krow-trial.apk`

Versión **0.2.1-trial**, código **3**, Android 7 o superior, ARM64/ARMv7. Tamaño: **136764786 bytes**, unos 130 MiB. Firma de prueba conservada, JavaScript/Hermes incluido, sin dependencia de Metro ni servidor local.

SHA256: `CB03A21209D47EE943948CAFAB3682A406E59E3840E4E5CE7296501EB8497EB8`.

Firma y estructura verificadas. Las 1490 entradas del APK se comprobaron sin encontrar la conexión ni la contraseña privada de PostgreSQL. La clave Android es la que el usuario autorizó temporalmente. Evidencia: `krow-app-mobile/docs/android-apk-20261007.json`; revisión del cierre: `krow-app-mobile/docs/driver-route-crash-review-20261007.md`.

## Validación

- Móvil: **147 pruebas**, 27 suites, TypeScript correcto; compilación Kotlin y APK exitosas.
- Backend: **104 pruebas**, 19 suites; otras 13 requieren PostgreSQL de prueba independiente. Se corrigieron referencias antiguas de las migraciones del piloto. Compilación y lint de los archivos afectados correctos.
- Supabase: migraciones `20261007145935_campus_origin_passenger_search` y `20261007150003_itnl_corridor_stop_catalog` aplicadas. PostGIS real comprobó ambos alcances y los RPCs compatibles; 17 puntos activos, 14 nuevos, cero coordenadas fuera de zona. Acceso anónimo rechazado y acceso autenticado conservado.
- Google Directions calculó recorridos desde el Instituto hacia las tres avenidas. PostGIS encontró 8, 9 y 9 referencias compatibles, respectivamente, dentro del corredor de esos recorridos de ejemplo.
- Railway: despliegue `27a8b37a-90d2-4a99-823d-c0b374231a51` exitoso. Health/readiness devolvieron 200 y `pilot: ready`; `/me` sin sesión respondió 401. El transporte WebSocket realizó su handshake. La API funciona sin el servidor local. [Evidencia de entrega](pilot-corrections-evidence-20261007.json).
- Las siete pruebas de búsqueda SQL incluyen un viaje ajeno al Instituto que no puede consumir el límite, subidas intermedias, orden de paradas y privacidad. Su fixture de distancia es sintético; la comprobación anterior usa PostGIS real.

## Prueba pendiente en el teléfono

1. Instalar el APK actualizado sobre la versión anterior y abrir «Ver ruta» varias veces.
2. Repetir con GPS apagado, permiso denegado y red interrumpida; confirmar que aparecen recuperación y controles de viaje.
3. Salir inmediatamente de la ruta y volver a abrirla. Comprobar seguimiento y ruta con pantalla bloqueada.
4. Buscar un destino por nombre; desplazar y seleccionar resultados con teclado abierto.
5. Publicar un viaje futuro desde el Instituto. Con otra cuenta, probar subida allí y en una parada intermedia compatible.

Si continúa el cierre, obtener `adb logcat -b crash -d` inmediatamente después para confirmar excepción, modelo y versión Android. La instalación, GPS en carretera y teclado iOS aún requieren verificación física.
