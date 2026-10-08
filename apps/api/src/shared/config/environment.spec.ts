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
  it('permite ajustar el radio de búsqueda y rechaza valores inválidos', () => {
    expect(
      validateEnvironment(required).PILOT_MATCHING_MAX_DISTANCE_METERS,
    ).toBe(3000);
    expect(
      validateEnvironment({
        ...required,
        PILOT_MATCHING_MAX_DISTANCE_METERS: '4500',
      }).PILOT_MATCHING_MAX_DISTANCE_METERS,
    ).toBe(4500);
    for (const value of ['0', '99', '20001', '3.5', 'invalid']) {
      expect(() =>
        validateEnvironment({
          ...required,
          PILOT_MATCHING_MAX_DISTANCE_METERS: value,
        }),
      ).toThrow('PILOT_MATCHING_MAX_DISTANCE_METERS');
    }
  });

  it('no habilita GPS online sin proveedor de rutas configurado', () => {
    const pilot = {
      ...required,
      RIDE_PILOT_ENABLED: 'true',
      RIDE_TRACKING_ENABLED: 'true',
      PILOT_DATABASE_URL: 'postgresql://pilot@localhost/pilot',
    };
    expect(() => validateEnvironment(pilot)).toThrow('GOOGLE_MAPS_API_KEY');
    expect(() =>
      validateEnvironment({ ...pilot, GOOGLE_MAPS_API_KEY: 'test-key' }),
    ).not.toThrow();
  });

  it('mantiene GPS y cierre de cuenta detrás de sus requisitos independientes', () => {
    expect(() =>
      validateEnvironment({ ...required, RIDE_TRACKING_ENABLED: 'true' }),
    ).toThrow('RIDE_PILOT_ENABLED');
    expect(() =>
      validateEnvironment({
        ...required,
        PILOT_ACCOUNT_CLOSURE_ENABLED: 'true',
      }),
    ).toThrow('soporte y aviso de privacidad');
  });

  it('rechaza credenciales requeridas ausentes', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Faltan variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY',
    );
  });
});
