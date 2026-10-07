# KROW: APK y backend para pruebas

Fecha local: 6 de octubre de 2026.

Este documento conserva el registro de la entrega anterior. El APK en la ruta compartida fue actualizado; usa la [entrega del 7 de octubre](krow-corrections-20261007.md) para su versión y comprobaciones actuales.

El APK está en `C:/Users/Novasys/Documents/krow-app-mobile/artifacts/android/krow-trial.apk`.
Versión `0.2.0-trial`, paquete `com.krownmobileapp`, Android 7 o superior, ARM64
y ARMv7. Tamaño: 136760626 bytes (unos 130 MiB). Es una compilación privada con
firma de prueba y JavaScript/Hermes incluido; no requiere Metro.

SHA256: `6F69E6A9EA16F837B9037DD0B9AD0A8384747D5FDE75851695CAE2C8EA8A5D4B`.

La API está publicada en [Railway](https://krow-api-production.up.railway.app/v1/health).
Piloto y tracking están habilitados. Readiness comprobó PostgreSQL y permisos
desde Railway; las consultas privadas sin JWT responden 401 y el transporte
WebSocket aprobó. No necesita que la API local permanezca encendida.

Supabase recibió las siete migraciones de esta actualización, incluyendo
privacidad de perfiles y cambio del escritor de viajes a la API. Se verificó
el LOGIN limitado por TLS; no se cambió la contraseña de postgres. La función
temporal de provisión quedó retirada y responde 410. Los conteos de 45 viajes,
33 reservas, 11 usuarios y cuatro reseñas se conservaron; el viaje en curso
sigue en curso. Las 33 migraciones recuperadas coinciden con el ledger.

## Prueba en el teléfono

1. Copiar el APK al Android e instalarlo. Abrirlo sin Metro y con la API local apagada.
2. Iniciar sesión y comprobar Inicio/Viajes/Perfil, modo pasajero/conductor y tema.
3. Usar dos cuentas: conductor aprobado con vehículo y pasajero. Completar reserva,
   aceptación, chat, inicio, subida, bajada, efectivo, finalización y reseña.
4. Conceder ubicación precisa al iniciar. Comprobar ruta, próxima parada y personas
   por subir/bajar; observar el vehículo desde la cuenta pasajero.
5. Probar pantalla bloqueada, pérdida y retorno de red/GPS, cierre de sesión y
   finalización. El ensayo físico de treinta minutos todavía no está realizado.

La clave Maps usada en el APK es la misma que el usuario autorizó temporalmente.
La API Directions del servidor respondió correctamente; queda comprobar Maps SDK
for Android en dispositivo y sus restricciones. El APK no contiene la conexión
ni la contraseña privada PostgreSQL: se inspeccionaron sus 1490 entradas ZIP.

## Pendientes para usuarios reales

Todavía faltan certificación física de GPS/mapas, QA visual y accesibilidad,
release con firma productiva, catálogo de la zona, conductores/vehículos aprobados,
soporte, privacidad y retención. Push permanece apagado hasta configurar Firebase;
el cierre de cuenta permanece apagado hasta aprobar su política operativa.

La auditoría Supabase mantiene diez avisos de [funciones SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
ejecutables por usuarios autenticados. Incluyen consultas intencionales y una
operación administrativa con guard; deben revisarse por contrato, sin revocar
las búsquedas indiscriminadamente. También continúa el aviso de [protección de
contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Railway conserva el crédito gratuito existente. Su [Trial](https://docs.railway.com/pricing/free-trial)
ofrece US$5 durante hasta treinta días y después Free aporta US$1 mensual de recursos.
El crédito limita la disponibilidad; no se contrató un plan de pago ni se añadió
un método de pago.

Evidencia: [activación API](railway-pilot-activation-20261006.json),
[actualización Supabase](pilot-supabase-update-20261006.json). La evidencia del APK
está en `krow-app-mobile/docs/android-apk-20261006.json`.
