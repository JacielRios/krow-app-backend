import { jest } from '@jest/globals';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { BookingsService } from './bookings.service.js';

describe('BookingsService commands', () => {
  const user: AuthenticatedUser = {
    id: 'user-id',
    email: 'user@example.com',
    accessToken: 'access-token',
    userMetadata: {},
  };

  function createService() {
    const rpc = jest
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    const from = jest.fn();
    const client = { rpc, from };
    const supabase = {
      forUser: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;

    return { service: new BookingsService(supabase), rpc, from };
  }

  it('confirma la reserva en una sola operación atómica', async () => {
    const { service, rpc, from } = createService();

    await expect(service.accept(user, 'booking-id')).resolves.toEqual({
      success: true,
    });
    expect(rpc).toHaveBeenCalledWith('update_booking_status', {
      p_booking_id: 'booking-id',
      p_new_status: 'confirmed',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('propaga la razón al rechazar la reserva', async () => {
    const { service, rpc } = createService();

    await service.reject(user, 'booking-id', 'Sin lugares disponibles');

    expect(rpc).toHaveBeenCalledWith('update_booking_status', {
      p_booking_id: 'booking-id',
      p_new_status: 'rejected',
      p_reason: 'Sin lugares disponibles',
    });
  });
});
