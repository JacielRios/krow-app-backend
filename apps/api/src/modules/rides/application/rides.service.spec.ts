import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { MatchingService } from '../../matching/matching.service.js';
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
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
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

    return {
      service: new RidesService(supabase, new MatchingService()),
      rpc,
      from,
    };
  }

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
