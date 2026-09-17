import { validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  const required = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  };

  it('usa valores seguros para ejecución local y hosting', () => {
    expect(validateEnvironment(required)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      CORS_ORIGINS: '*',
    });
  });

  it('rechaza un puerto inválido', () => {
    expect(() =>
      validateEnvironment({ ...required, PORT: 'not-a-port' }),
    ).toThrow('PORT debe ser un número entero entre 1 y 65535');
  });

  it('rechaza credenciales requeridas ausentes', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Faltan variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY',
    );
  });
});
