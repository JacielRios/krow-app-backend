import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import type { RoutesService } from '../../routes/application/routes.service.js';
import { RidesService } from './rides.service.js';

describe('RidesService commands', () => {
  const user: AuthenticatedUser = {
    id: 'user-id',
    email: 'user@example.com',
    accessToken: 'access-token',
    userMetadata: {},
  };

  function createService(bookingRideId = 'ride-id') {
    const rpc = jest
      .fn<
        (...args: unknown[]) => Promise<{
          data: string | number | null;
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
    });
    const maybeSingle = jest
      .fn<
        () => Promise<{
          data: { ride_id: string };
          error: null;
        }>
      >()
      .mockResolvedValue({
        data: { ride_id: bookingRideId },
        error: null,
      });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { rpc, from };
    const supabase = {
      forUser: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;
    const routes = { compute } as unknown as RoutesService;

    return {
      service: new RidesService(supabase, routes),
      rpc,
      from,
      compute,
    };
  }

  const rideDto = {
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
    expect(compute).toHaveBeenCalledWith({
      origin: rideDto.origin,
      destination: rideDto.destination,
      departureTime: rideDto.departureTime,
    });
    expect(rpc.mock.calls[0]?.[0]).toBe('create_ride_v2');
    const callPayload = rpc.mock.calls[0]?.[1] as {
      p_payload: Record<string, unknown>;
    };
    expect(callPayload.p_payload).toMatchObject({
      route_polyline: 'polyline-from-google',
      route_distance_meters: 1200,
      transport_stop_ids: rideDto.transportStopIds,
      price_per_seat: 45,
    });
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
