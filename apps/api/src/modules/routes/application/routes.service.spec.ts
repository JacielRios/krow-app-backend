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
    corridorId: '77777777-7777-4777-8777-777777777777',
    name: 'Ruta frecuente',
    origin: historicalOrigin,
    destination: { address: 'Destino', lat: 25.68, lng: -100.2 },
    transportStopIds: ['verified-stop'],
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
    const corridorSpy = jest.spyOn(service, 'corridors').mockResolvedValue([
      {
        corridorId: dto.corridorId,
        name: 'Avenida',
        code: 'test',
        direction: null,
        stops: [
          {
            stopId: 'verified-stop',
            externalId: 'catalog-stop',
            name: 'Parada verificada',
            address: 'Avenida',
            municipality: 'Guadalupe',
            location: { lat: 25.67, lng: -100.24 },
            direction: null,
            active: true,
            stopOrder: 1,
            stopType: 'general',
            source: 'synthetic',
          },
        ],
      },
    ]);
    const publicationSpy = jest
      .spyOn(service, 'publicationStops')
      .mockResolvedValue(['campus-stop', 'verified-stop']);
    return {
      service,
      rpc,
      forUser,
      routePreview,
      routeRpc,
      corridorSpy,
      publicationSpy,
    };
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
        [{ lat: 25.67, lng: -100.24 }],
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
        transport_stop_ids: ['campus-stop', 'verified-stop'],
        corridor_id: dto.corridorId,
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
      if (!usePilot) expect(forUser).toHaveBeenCalledWith(user.accessToken);
      expect(dto.origin).toEqual(historicalOrigin);
    },
  );

  it('allows a favorite without optional vehicle, seats or price defaults', async () => {
    const { service, rpc } = setup();
    await expect(service.createFavorite(user, dto)).resolves.toEqual({
      routeId: 'saved-favorite',
    });
    const payload = rpc.mock.calls[0][1].p_payload as Record<string, unknown>;
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

  it('keeps avenue guide points when the driver enables only its last stop', async () => {
    const { service, routePreview, corridorSpy } = setup();
    const locations = [
      { lat: 25.664, lng: -100.238 },
      { lat: 25.662, lng: -100.228 },
      { lat: 25.66, lng: -100.218 },
    ];
    const stops = locations.map((location, index) => ({
      stopId: `selected-${index}`,
      externalId: `catalog-${index}`,
      name: `Synthetic ${index}`,
      address: 'Avenida',
      municipality: 'Guadalupe',
      location,
      direction: null,
      active: true,
      stopOrder: index + 1,
      stopType: 'general',
      source: 'synthetic',
    }));
    corridorSpy.mockResolvedValue([
      {
        corridorId: dto.corridorId,
        name: 'Avenida',
        code: 'test',
        direction: null,
        stops,
      },
    ]);
    await service.preview(user, {
      origin: CAMPUS_ORIGIN,
      destination: locations[2],
      corridorId: dto.corridorId,
      transportStopIds: ['selected-2'],
    });
    expect(routePreview).toHaveBeenCalledWith(
      CAMPUS_ORIGIN,
      locations[2],
      undefined,
      locations,
    );
    await expect(
      service.preview(user, {
        origin: CAMPUS_ORIGIN,
        destination: locations[0],
        corridorId: dto.corridorId,
        transportStopIds: ['selected-2'],
      }),
    ).rejects.toThrow('dentro del trayecto');
  });

  it('validates explicit selections and silently adds only the campus pickup', async () => {
    const { service, publicationSpy } = setup();
    publicationSpy.mockRestore();
    const campusId = 'campus-central';
    const campusQuery = {
      eq: jest.fn(),
      maybeSingle: jest
        .fn<() => Promise<{ data: { stop_id: string }; error: null }>>()
        .mockResolvedValue({ data: { stop_id: campusId }, error: null }),
    };
    campusQuery.eq.mockReturnValue(campusQuery);
    const supabaseClient = { from: () => ({ select: () => campusQuery }) };
    // The fixture supplies only the catalog lookup, without persistence calls.
    jest
      .spyOn(service as unknown as { client: () => unknown }, 'client')
      .mockReturnValue(supabaseClient);
    expect(
      await service.publicationStops(user, dto.corridorId, ['verified-stop']),
    ).toEqual([campusId, 'verified-stop']);
    await expect(
      service.publicationStops(user, dto.corridorId, []),
    ).rejects.toThrow('al menos una');
    await expect(
      service.publicationStops(user, dto.corridorId, ['foreign-stop']),
    ).rejects.toThrow('avenida activa');
    await expect(
      service.publicationStops(user, dto.corridorId, [
        'verified-stop',
        'verified-stop',
      ]),
    ).rejects.toThrow('avenida activa');
  });
});
