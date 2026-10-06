export interface Environment {
  NODE_ENV: string;
  HOST: string;
  PORT: number;
  CORS_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GOOGLE_MAPS_API_KEY?: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const;
  const read = (key: string, fallback = ''): string =>
    typeof input[key] === 'string' ? input[key] : fallback;
  const missing = required.filter((key) => !read(key).trim());
  if (missing.length > 0)
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);

  const port = input.PORT ? Number(input.PORT) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT debe ser un número entero entre 1 y 65535');

  if (!['', 'true', 'false'].includes(read('RIDE_RUNTIME_ENABLED')))
    throw new Error('RIDE_RUNTIME_ENABLED debe ser true o false');
  if (read('RIDE_RUNTIME_ENABLED') === 'true') {
    const runtimeRequired = [
      'RUNTIME_DATABASE_URL',
      'RUNTIME_REDIS_URL',
      'RUNTIME_KAFKA_BROKERS',
      'MAPBOX_ACCESS_TOKEN',
      'RUNTIME_TOKEN_ENCRYPTION_KEY',
    ];
    if (read('NODE_ENV') === 'production') {
      runtimeRequired.push(
        'RUNTIME_DATABASE_CA',
        'RUNTIME_KAFKA_USERNAME',
        'RUNTIME_KAFKA_PASSWORD',
      );
      if (read('RIDE_RUNTIME_PROCESS', 'api') === 'worker')
        runtimeRequired.push(
          'FCM_PROJECT_ID',
          'FCM_CLIENT_EMAIL',
          'FCM_PRIVATE_KEY',
          'APNS_KEY_ID',
          'APNS_TEAM_ID',
          'APNS_PRIVATE_KEY',
          'APNS_BUNDLE_ID',
          'PAGERDUTY_PRIMARY_KEY',
          'PAGERDUTY_BACKUP_KEY',
          'PAGERDUTY_SUPERVISOR_KEY',
          'TWILIO_ACCOUNT_SID',
          'TWILIO_AUTH_TOKEN',
          'TWILIO_FROM',
          'SAFETY_BACKUP_PHONE',
          'SAFETY_SUPERVISOR_PHONE',
        );
    }
    const absent = runtimeRequired.filter((key) => !read(key).trim());
    if (absent.length)
      throw new Error(`Configuración v2 incompleta: ${absent.join(', ')}`);
    if (
      Buffer.from(read('RUNTIME_TOKEN_ENCRYPTION_KEY'), 'base64').length !== 32
    )
      throw new Error('La clave de cifrado v2 debe tener 32 bytes');
    if (!['api', 'worker'].includes(read('RIDE_RUNTIME_PROCESS', 'api')))
      throw new Error('Proceso v2 inválido');
    const quota = Number(read('MAPBOX_REQUESTS_PER_MINUTE', '250'));
    if (!Number.isInteger(quota) || quota < 1)
      throw new Error('Cuota de mapas inválida');
  }

  return {
    ...input,
    NODE_ENV: read('NODE_ENV', 'development'),
    HOST: read('HOST', '0.0.0.0'),
    PORT: port,
    CORS_ORIGINS: read('CORS_ORIGINS', '*'),
    SUPABASE_URL: read('SUPABASE_URL'),
    SUPABASE_ANON_KEY: read('SUPABASE_ANON_KEY'),
    GOOGLE_MAPS_API_KEY: read('GOOGLE_MAPS_API_KEY') || undefined,
  };
}
