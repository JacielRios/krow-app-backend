# Firebase Android: configuración y límites de aceptación

Fecha: 20 de octubre de 2026. Alcance autorizado: continuar la integración de notificaciones para Android en el proyecto existente del usuario. Se preservaron los cambios anteriores de ambos repositorios.

**Actualización posterior:** la API compatible ya está publicada en Railway, despliegue `5d625538-76ab-4961-890d-493a72978442`, estado SUCCESS. Once comprobaciones HTTP y transporte WebSocket aprobaron; el bloqueo de compatibilidad del APK se levantó. Push permanece desactivado. [Evidencia de publicación](railway-update-20261020.md). Las observaciones sobre la instancia anterior y `skipDeploys` describen la preparación previa.

## Configuración completada

- Acceso autenticado al proyecto activo **KrowApp**, ID `krowapp`, número `671728344534`.
- Registro de **KROW Android**, paquete `com.krownmobileapp`, app ID `1:671728344534:android:8b8c61c0ec6b88fe801877`.
- Descarga de la configuración cliente con la CLI oficial a `android/app/google-services.json` del repositorio móvil; Git confirmó que el archivo está ignorado. No se añadió ninguna dependencia de aplicación.
- Credencial de servidor suministrada mediante una ruta local fuera de ambos repositorios. Se comprobó el proyecto, el tipo RSA y una firma local. El proveedor compilado existente `NotificationProviders.fcmToken` obtuvo un token OAuth de Google sin imprimirlo. Esto valida autenticación; no demuestra todavía permiso de envío ni entrega FCM.
- Configuradas en Railway: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` y una nueva `PILOT_PUSH_ENCRYPTION_KEY` aleatoria de 32 bytes en base64. Se comprobó previamente que las cuatro variables faltaban; no se sobrescribió una clave existente. `PILOT_PUSH_ENABLED=false` se mantuvo explícito.
- Operación Railway con **`skipDeploys=true`**: credenciales preparadas para el próximo despliegue, sin reiniciar ni reemplazar la instancia actual. No se copiaron tokens personales de la CLI al servidor.
- El usuario confirmó que **FCM HTTP v1 está habilitada**. Es una confirmación del usuario; no una prueba de envío desde NestJS.

Railway: proyecto `6662debb-cb31-44bc-a057-dcdf64927d71`, entorno de producción `0d12e292-e100-41d3-8fc3-ba8350c1cc55`, servicio `3092ac58-1684-4dbc-bdef-776c6dfb5980`.

## Verificaciones ejecutadas

1. Validación del JSON público real con el build existente: `FirebaseReady=True`, dominio correcto y push desactivado.
2. Cuatro comprobaciones sintéticas en PowerShell 7 y Windows PowerShell: configuración válida, restauración del entorno, rechazo de cuenta de servicio y rechazo de paquete distinto. La primera ejecución en PowerShell 7 detectó que `$null` se restauraba como cadena vacía; se corrigió con eliminación explícita de la variable ausente y ambas ejecuciones finales aprobaron.
3. Compilación Android **0.5.3-trial**, código **10**, exitosa en 3 minutos 49 segundos. ARM64/ARMv7, firma de prueba existente, Hermes incluido, sin depuración ni tráfico HTTP claro.
4. Firma y metadatos del APK verificados con `apksigner`/`aapt`. Cuatro recursos nativos Firebase contrastados con el JSON real, sin imprimir claves. El volcado inicial sin `--values` no permitía comprobar valores; la inspección final con `aapt dump --values resources` verificó los cuatro.
5. Receptor FCM, permiso de notificaciones y dominio de App Links presentes en el APK. ADB consultado fuera del sandbox: **cero dispositivos**. Sin instalación ni prueba de recepción.
6. Variables requeridas verificadas por nombre en Railway, sin leer sus valores de regreso.
7. API pública `/v1/health`: HTTP **200**, estado `ok` después de configurar variables. Railway conserva el despliegue exitoso `d2f5d2f9-742d-4b7f-8be4-ec12aa4fa21d` del 16 de octubre y no muestra un despliegue pendiente.

APK móvil: `artifacts/android/krow-0.5.3-trial.apk`, 137027226 bytes. SHA-256: `2DF4BAE4F0B4ACE510CECDD72E31D1449C91C43DC730BA23B87E8D0CDF3DAEEA`. Evidencia móvil: `docs/android-apk-0.5.3-20261020.json`.

## Pendientes para activar y aceptar push

1. **Completado posteriormente:** API compatible desplegada y contrato `requestId` verificado mediante entrada que alcanza la consulta SQL y se rechaza por validación de paradas, sin crear viajes. Railway aceptó el nuevo build cuando volvió a estar operativo; se conservaron plan, servicio y una réplica. [Publicación](railway-update-20261020.md).
2. Confirmar el redirect de Supabase Auth y la aceptación pendiente de enlaces en Android. Esta etapa no cambia esos ajustes ni los da por probados.
3. Activar coordinadamente `PILOT_PUSH_ENABLED` y `KROW_PILOT_PUSH_ENABLED`, desplegar/compilar sus versiones compatibles y probar el registro del dispositivo con una cuenta autorizada.
4. Verificar envío FCM con los eventos reales de reserva y viaje, actualización de datos y apertura de la pantalla correcta. Probar app abierta, segundo plano y proceso cerrado, además de permisos denegados y cambio de cuenta. No asumir recepción tras cierre forzado del sistema.
5. Registrar evidencia física con un Android y Google Play Services. La prueba OAuth realizada no sustituye estas verificaciones.

La actividad de notificaciones permanece **parcialmente completada**. No se enviaron avisos, no se declaró una prueba integral aprobada y no se habilitó iOS. La guía operativa actual está en `docs/firebase-android-setup.md` del repositorio móvil. No se modificó el esquema de Supabase ni el diseño visual.
