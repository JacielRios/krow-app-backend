import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type { GoogleMapsService } from '../../maps/infrastructure/google-maps.service.js';
import type { PilotDatabase } from '../../pilot/pilot.database.js';
import { CAMPUS_ORIGIN } from '../domain/campus-origin.js';
import type { SaveFavoriteRouteDto } from '../presentation/route.dto.js';
import { RoutesService } from './routes.service.js';

describe('RoutesService origin and failure safeguards', () => {
  const user: AuthenticatedUser = {
    id: 'driver-id',
    email: 'driver@example.com',
    accessToken: 'synthetic-access-token',
    userMetadata: {},
    appMetadata: {},
  };
  const historicalOrigin = {
    address: 'Salida histórica',
    placeId: 'historical-place',
    lat: 25.7,
    lng: -100.3,
  };
  const dto: SaveFavoriteRouteDto = {
    name: 'Ruta frecuente',
    origin: historicalOrigin,
    destination: { address: 'Destino', lat: 25.68, lng: -100.2 },
    transportStopIds: ['untrusted-stop'],
  };
  const preview = {
    // Geometría sintética válida; el proveedor se sustituye completamente.
    encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    provider: 'google' as const,
    calculatedAt: '2026-10-07T12:00:00.000Z',
    distanceMeters: 1200,
    durationSeconds: 360,
    bounds: {
      northeast: { lat: 43.252, lng: -120.2 },
      southwest: { lat: 38.5, lng: -126.453 },
    },
  };

  function setup(usePilot = false) {
    const rpc =
      jest.fn<
        (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      >();
    rpc.mockImplementation((name) =>
      Promise.resolve({
        data:
          name === 'find_compatible_transport_stops'
            ? [
                {
                  stop_id: 'verified-stop',
                  external_id: 'catalog-stop',
                  name: 'Parada verificada',
                  address: 'Avenida',
                  municipality: 'Guadalupe',
                  lat: 25.67,
                  lng: -100.24,
                  distance_from_route_m: 10,
                  route_fraction: 0.5,
                },
              ]
            : 'saved-favorite',
        error: null,
      }),
    );
    const forUser = jest.fn().mockReturnValue({ rpc });
    const routePreview = jest
      .fn<GoogleMapsService['routePreview']>()
      .mockResolvedValue(preview);
    const routeRpc = jest
      .fn<(actor: string, name: string, args: unknown[]) => Promise<string>>()
      .mockResolvedValue('saved-favorite');
    const service = new RoutesService(
      { forUser } as unknown as SupabaseService,
      { routePreview } as unknown as GoogleMapsService,
      usePilot
        ? ({ enabled: true, routeRpc } as unknown as PilotDatabase)
        : undefined,
    );
    return { service, rpc, forUser, routePreview, routeRpc };
  }

  it.each([
    ['create', false],
    ['update', false],
    ['create', true],
    ['update', true],
  ] as const)(
    '%s favorite forces campus geometry and address (private API: %s)',
    async (operation, usePilot) => {
      const { service, rpc, forUser, routePreview, routeRpc } = setup(usePilot);
      const result =
        operation === 'create'
          ? await service.createFavorite(user, dto)
          : await service.updateFavorite(user, 'existing-favorite', dto);
      expect(result).toEqual({ routeId: 'saved-favorite' });
      expect(routePreview).toHaveBeenCalledWith(
        CAMPUS_ORIGIN,
        dto.destination,
        undefined,
      );
      const payload = usePilot
        ? routeRpc.mock.calls[0][2][0]
        : rpc.mock.calls.find(([name]) => name === 'upsert_favorite_route')?.[1]
            .p_payload;
      expect(payload).toMatchObject({
        origin_place_id: CAMPUS_ORIGIN.placeId,
        origin_address: CAMPUS_ORIGIN.address,
        origin_lat: CAMPUS_ORIGIN.lat,
        origin_lng: CAMPUS_ORIGIN.lng,
        transport_stop_ids: ['verified-stop'],
      });
      expect(payload).toHaveProperty(
        'route_id',
        operation === 'update' ? 'existing-favorite' : undefined,
      );
      if (usePilot)
        expect(routeRpc).toHaveBeenCalledWith(
          user.id,
          'upsert_favorite_route',
          [payload],
        );
      expect(forUser).toHaveBeenCalledWith(user.accessToken);
      expect(dto.origin).toEqual(historicalOrigin);
    },
  );

  it('allows a favorite without optional vehicle, seats or price defaults', async () => {
    const { service, rpc } = setup();
    await expect(service.createFavorite(user, dto)).resolves.toEqual({
      routeId: 'saved-favorite',
    });
    const payload = rpc.mock.calls[1][1].p_payload as Record<string, unknown>;
    expect(payload.default_vehicle_id).toBeUndefined();
    expect(payload.default_available_seats).toBeUndefined();
    expect(payload.default_price_per_seat).toBeUndefined();
  });

  it('keeps the actual historical origin in a generic preview', async () => {
    const { service, routePreview } = setup();
    const departureTime = '2026-10-07T15:00:00Z';
    await expect(
      service.preview(user, {
        origin: historicalOrigin,
        destination: dto.destination,
        departureTime,
      }),
    ).resolves.toMatchObject({
      ...preview,
      compatibleStops: [{ stopId: 'verified-stop' }],
    });
    expect(routePreview).toHaveBeenCalledWith(
      historicalOrigin,
      dto.destination,
      departureTime,
    );
  });

  it('rejects a missing provider route with a controlled error before any database write', async () => {
    const { service, routePreview, rpc, routeRpc } = setup(true);
    routePreview.mockResolvedValue(null);
    await expect(service.createFavorite(user, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(routeRpc).not.toHaveBeenCalled();
  });
});
