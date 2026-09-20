import { decodeGooglePolyline } from './polyline.js';

describe('decodeGooglePolyline', () => {
  it('decodifica el ejemplo canónico de Google en GeoJSON lng/lat', () => {
    expect(decodeGooglePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual({
      type: 'LineString',
      coordinates: [
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
      ],
    });
  });

  it('rechaza una geometría sin segmento', () => {
    expect(() => decodeGooglePolyline('')).toThrow(
      'La ruta calculada no contiene suficientes puntos',
    );
  });
});
