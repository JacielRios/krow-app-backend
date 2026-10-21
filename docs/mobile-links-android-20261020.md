# Enlaces de KROW Android

Dominio aprobado: `https://krow-web-gamma.vercel.app`. Alcance actual: Android y APK privado de pruebas.

## Implementado y publicado

- `/.well-known/assetlinks.json`: asociación de `com.krownmobileapp` con el certificado actual de prueba. Se obtuvo el SHA-256 del certificado del keystore, no del archivo APK.
- `/rides/{UUID}`: página de respaldo sin datos del viaje y apertura explícita del paquete Android. Un identificador mal formado devuelve 404. La app conserva la comprobación de acceso en el backend.
- `/auth/callback`: respaldo para volver a la app, sin intercambiar códigos ni crear sesiones en el navegador. Usa `Cache-Control: no-store`, `Referrer-Policy: no-referrer` y exclusión de indexado.
- Las páginas solo construyen Intents para el paquete existente y el dominio aprobado; los parámetros se vuelven a codificar y se rechazan entradas ambiguas.
- El build Android transmite el mismo origen a React Native y a los recursos/manifest nativos. La configuración de prueba utiliza el dominio aprobado.

Se publicó el despliegue Vercel `dpl_2ZpcGXJnHMaf9VkccHFDPuAvqGyM`, primero sin mover el dominio, después de las verificaciones se promovió. La [evidencia pública](mobile-links-public-20261020.json) registra cinco comprobaciones HTTP sin credenciales y la [evidencia previa](mobile-links-staged-20261020.json) comprueba contenido y cabeceras. Las 55 pruebas web y el build Next.js aprobaron. La vista publicada se revisó en navegador.

El certificado asociado es exclusivamente el de los APK privados actuales. Antes de una entrega pública debe sustituirse o complementarse con el certificado de firma de distribución verificado; no constituye preparación completa para Google Play.

## Paso manual pendiente en Supabase

El panel de Supabase solicitó login y el conector disponible no permite leer/modificar esta configuración. No se cambió la lista de redirecciones ni se enviaron correos de prueba.

1. Abre [Auth → URL Configuration](https://supabase.com/dashboard/project/yyjbqzsokxpzhevpanyq/auth/url-configuration).
2. En **Redirect URLs**, añade exactamente `https://krow-web-gamma.vercel.app/auth/callback` y guarda. Conserva las entradas vigentes; no hace falta reemplazar el Site URL. Si hay plantillas personalizadas de correo, comprobar que respeten `RedirectTo` y no una URL fija incompatible. [Referencia Supabase](https://supabase.com/docs/guides/auth/redirect-urls).
3. Después del APK compatible, solicita desde la app una recuperación de acceso y una confirmación de correo y comprueba su recorrido completo. Para PKCE usa el mismo Android en el que se originó la solicitud.

## Verificación Android pendiente

Con el APK compatible instalado y un Android conectado, comprobar el dominio con:

```text
adb shell pm verify-app-links --re-verify com.krownmobileapp
adb shell pm get-app-links com.krownmobileapp
```

Esperar a que termine la verificación del sistema y abrir un enlace real autorizado, con la app abierta, en segundo plano y cerrada. Probar también sesión cerrada y acceso de conductor pendiente. [Referencia Android](https://developer.android.com/training/app-links/verify-applinks).

Las pruebas móviles cubren conservación del viaje hasta el login, apertura en caliente, dominio ajeno, espera del acceso de conductor y códigos de acceso malformados/ambiguos. No sustituyen la asociación y apertura real en un teléfono.

## Límites

Los enlaces a reservas se abren mediante el UUID de su viaje y el servidor decide qué información puede consultar la cuenta. No existe todavía un enlace independiente `/bookings/{bookingId}` ni un modelo funcional de invitaciones: no se presentan como entregables terminados. Push sigue pendiente de un proyecto Firebase y su verificación real. Railway continúa siendo una dependencia independiente para publicar la API de idempotencia antes de instalar el móvil nuevo.
