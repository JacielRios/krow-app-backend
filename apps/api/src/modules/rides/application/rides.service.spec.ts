import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type { RoutesService } from '../../routes/application/routes.service.js';
import { RidesService } from './rides.service.js';
import { CAMPUS_ORIGIN } from '../../routes/domain/campus-origin.js';

describe('RidesService commands', () => {
  const user: AuthenticatedUser = {
    id: 'user-id',
    email: 'user@example.com',
    accessToken: 'access-token',
    userMetadata: {},
    appMetadata: {},
  };

  function createService(bookingRideId = 'ride-id') {
    const rpc = jest
      .fn<
        (...args: unknown[]) => Promise<{
          data: unknown;
          error: { message: string } | null;
        }>
      >()
      .mockResolvedValue({ data: null, error: null });
    const compute = jest.fn<
      () => Promise<{
        preview: {
          encodedPolyline: string;
          distanceMeters: number;
          durationSeconds: number;
          provider: 'google';
          calculatedAt: string;
        };
        routeGeoJson: {
          type: 'LineString';
          coordinates: [number, number][];
        };
        compatibleStops: Array<{ stopId: string }>;
      }>
    >();
    compute.mockResolvedValue({
      preview: {
        encodedPolyline: 'polyline-from-google',
        distanceMeters: 1200,
        durationSeconds: 360,
        provider: 'google',
        calculatedAt: '2026-09-19T12:00:00.000Z',
      },
      routeGeoJson: {
        type: 'LineString',
        coordinates: [
          [-100.24, 25.66],
          [-100.25, 25.67],
        ],
      },
      compatibleStops: [
        { stopId: '44444444-4444-4444-8444-444444444444' },
        { stopId: '55555555-5555-4555-8555-555555555555' },
      ],
    });
    const maybeSingle = jest
      .fn<
        () => Promise<{
          data: {
            ride_id: string;
            origin_lat: number;
            origin_lng: number;
            origin_address: string;
          };
          error: null;
        }>
      >()
      .mockResolvedValue({
        data: {
          ride_id: bookingRideId,
          origin_lat: 25.66,
          origin_lng: -100.24,
          origin_address: 'Campus',
        },
        error: null,
      });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { rpc, from };
    const supabase = {
      forUser: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;
    const routes = {
      computeWithCompatibleStops: compute,
      publicationStops: jest
        .fn<() => Promise<string[]>>()
        .mockResolvedValue([
          '44444444-4444-4444-8444-444444444444',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ]),
    } as unknown as RoutesService;

    return {
      service: new RidesService(supabase, routes),
      rpc,
      from,
      compute,
    };
  }

  const rideDto = {
    corridorId: '77777777-7777-4777-8777-777777777777',
    vehicleId: '11111111-1111-4111-8111-111111111111',
    origin: { lat: 25.66, lng: -100.24 },
    destination: { lat: 25.67, lng: -100.25 },
    originAddress: 'Campus',
    destinationAddress: 'Centro',
    routePolyline: 'polyline-falsa-del-cliente',
    transportStopIds: [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ],
    departureTime: '2026-09-20T12:00:00.000Z',
    availableSeats: 2,
    pricePerSeatCents: 4500,
  };

  it('recalcula en backend y jamás usa el polyline enviado por el cliente', async () => {
    const { service, rpc, compute } = createService();
    rpc.mockResolvedValueOnce({ data: 'ride-created', error: null });

    await expect(service.create(user, rideDto)).resolves.toEqual({
      rideId: 'ride-created',
    });
    expect(compute).toHaveBeenCalledWith(user, {
      origin: CAMPUS_ORIGIN,
      destination: rideDto.destination,
      departureTime: rideDto.departureTime,
      corridorId: rideDto.corridorId,
      transportStopIds: rideDto.transportStopIds,
    });
    expect(rpc.mock.calls[0]?.[0]).toBe('create_ride_v2');
    const callPayload = rpc.mock.calls[0]?.[1] as {
      p_payload: Record<string, unknown>;
    };
    expect(callPayload.p_payload).toMatchObject({
      origin_lat: CAMPUS_ORIGIN.lat,
      origin_lng: CAMPUS_ORIGIN.lng,
      origin_address: CAMPUS_ORIGIN.address,
      route_polyline: 'polyline-from-google',
      route_distance_meters: 1200,
      transport_stop_ids: [
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ],
      price_per_seat: 45,
    });
  });

  it('keeps a historical origin when editing an existing scheduled trip', async () => {
    const { service, compute, rpc } = createService();
    await service.update(user, 'ride-id', {
      ...rideDto,
      origin: { lat: 30, lng: -90 },
      version: 1,
    });
    expect(compute).toHaveBeenCalledWith(user, {
      origin: rideDto.origin,
      destination: rideDto.destination,
      departureTime: rideDto.departureTime,
      corridorId: rideDto.corridorId,
      transportStopIds: rideDto.transportStopIds,
    });
    expect(rpc.mock.calls[0]?.[0]).toBe('update_ride_v2');
    const updateArgs = rpc.mock.calls[0]?.[1] as {
      p_payload: { origin_lat: number };
    };
    expect(updateArgs.p_payload.origin_lat).toBe(rideDto.origin.lat);
  });

  it('keeps campus pickups fixed and allows an explicit intermediate pickup scope', async () => {
    const { service, rpc } = createService();
    const dto = {
      origin: rideDto.origin,
      destination: rideDto.destination,
      maxDistanceMeters: 1000,
      pickupScope: 'campus' as const,
    };
    await service.stopCandidates(user, dto);
    expect(rpc).toHaveBeenCalledWith(
      'get_passenger_stop_candidates_v2',
      expect.objectContaining({
        p_origin_lat: CAMPUS_ORIGIN.lat,
        p_pickup_scope: 'campus',
      }),
    );
    rpc.mockClear();
    await service.stopCandidates(user, { ...dto, pickupScope: 'route' });
    expect(rpc).toHaveBeenCalledWith(
      'get_passenger_stop_pairs_v2',
      expect.objectContaining({
        p_origin_lat: rideDto.origin.lat,
        p_pickup_scope: 'route',
      }),
    );
  });

  it('convierte un conflicto de versión en HTTP 409', async () => {
    const { service, rpc } = createService();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Conflicto de version del viaje' },
    });

    await expect(
      service.update(user, 'ride-id', { ...rideDto, version: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('inicia el viaje usando directamente la RPC atómica', async () => {
    const { service, rpc, from } = createService();

    await expect(service.start(user, 'ride-id')).resolves.toEqual({
      success: true,
    });
    expect(rpc).toHaveBeenCalledWith('start_ride', {
      p_ride_id: 'ride-id',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('propaga la razón al cancelar un viaje', async () => {
    const { service, rpc } = createService();

    await service.cancel(user, 'ride-id', 'Cambio de planes');

    expect(rpc).toHaveBeenCalledWith('cancel_ride', {
      p_ride_id: 'ride-id',
      p_reason: 'Cambio de planes',
    });
  });

  it('expone la finalización completa del viaje', async () => {
    const { service, rpc } = createService();

    await service.complete(user, 'ride-id');

    expect(rpc).toHaveBeenCalledWith('complete_ride', {
      p_ride_id: 'ride-id',
    });
  });

  it('rechaza una reserva que no pertenece al viaje de la URL', async () => {
    const { service, rpc } = createService('another-ride-id');

    await expect(
      service.completeStop(user, 'ride-id', 'booking-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
  });
});
