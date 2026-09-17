import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleMapsService } from './google-maps.service.js';

describe('GoogleMapsService', () => {
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
});
