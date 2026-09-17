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
