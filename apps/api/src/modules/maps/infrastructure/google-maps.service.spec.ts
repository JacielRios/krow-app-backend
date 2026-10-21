import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleMapsService } from './google-maps.service.js';

describe('GoogleMapsService', () => {
  it('returns explicit structured address fields without guessing a municipality or driving direction', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              formatted_address: 'Av. Eloy Cavazos 7010, Guadalupe',
              place_id: 'synthetic',
              address_components: [
                { long_name: 'Av. Eloy Cavazos', types: ['route'] },
                { long_name: '7010', types: ['street_number'] },
                {
                  long_name: 'Guadalupe',
                  types: ['administrative_area_level_2'],
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      service('synthetic-server-key').reverseGeocode({
        lat: 25.65,
        lng: -100.2,
      }),
    ).resolves.toMatchObject({
      municipality: 'Guadalupe',
      road: 'Av. Eloy Cavazos',
      streetNumber: '7010',
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const service = (apiKey?: string) =>
    new GoogleMapsService({
      get: jest.fn().mockReturnValue(apiKey),
    } as unknown as ConfigService);

  it('rechaza llamadas si la llave solo-servidor no está configurada', async () => {
    await expect(service().autocomplete('centro')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('normaliza las sugerencias de Google antes de enviarlas al móvil', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          predictions: [
            {
              place_id: 'place-1',
              description: 'Centro, México',
              structured_formatting: {
                main_text: 'Centro',
                secondary_text: 'México',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service('server-key').autocomplete('centro')).resolves.toEqual(
      [
        {
          placeId: 'place-1',
          description: 'Centro, México',
          mainText: 'Centro',
          secondaryText: 'México',
        },
      ],
    );
  });

  it('convierte ZERO_RESULTS en una colección vacía', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), {
        status: 200,
      }),
    );

    await expect(
      service('server-key').autocomplete('inexistente'),
    ).resolves.toEqual([]);
  });
  it('shares concurrent requests and enforces the outbound quota', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), {
          status: 200,
        }),
      ),
    );
    const maps = new GoogleMapsService(
      new ConfigService({
        GOOGLE_MAPS_API_KEY: 'synthetic',
        GOOGLE_MAPS_REQUESTS_PER_MINUTE: '1',
      }),
    );
    await Promise.all([
      maps.autocomplete('centro'),
      maps.autocomplete('centro'),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(maps.autocomplete('otro')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
