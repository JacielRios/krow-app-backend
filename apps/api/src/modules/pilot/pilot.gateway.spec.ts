import { jest } from '@jest/globals';
import type { Socket } from 'socket.io';
import type { PilotService } from './pilot.service.js';
import { PilotGateway } from './pilot.gateway.js';
import type { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';

describe('pilot socket distribution', () => {
  const rideId = '12345678-1234-1234-1234-123456789012';
  let gateway: PilotGateway;
  let snapshot: ReturnType<typeof jest.fn<PilotService['snapshot']>>;
  let getUser: ReturnType<typeof jest.fn<SupabaseService['getUser']>>;
  const socket = (id: string) => {
    const result = {
      id,
      connected: true,
      handshake: { auth: { token: 'test', rideId } },
      emit: jest.fn(),
      disconnect: jest.fn(() => {
        result.connected = false;
      }),
    };
    return result;
  };
  beforeEach(() => {
    jest.useFakeTimers();
    snapshot = jest
      .fn<PilotService['snapshot']>()
      .mockResolvedValue({ rideId } as Awaited<
        ReturnType<PilotService['snapshot']>
      >);
    getUser = jest.fn<SupabaseService['getUser']>().mockResolvedValue({
      data: { user: { id: 'actor', user_metadata: {}, app_metadata: {} } },
      error: null,
    } as Awaited<ReturnType<SupabaseService['getUser']>>);
    gateway = new PilotGateway(
      { snapshot } as unknown as PilotService,
      { getUser } as unknown as SupabaseService,
    );
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });
  it('limits concurrent streams per account and releases a disconnected stream', async () => {
    const clients = [
      socket('one'),
      socket('two'),
      socket('three'),
      socket('four'),
    ];
    for (const client of clients)
      await gateway.handleConnection(client as unknown as Socket);
    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(clients[3].disconnect).toHaveBeenCalledWith(true);
    clients[0].connected = false;
    gateway.handleDisconnect(clients[0] as unknown as Socket);
    const next = socket('five');
    await gateway.handleConnection(next as unknown as Socket);
    expect(next.emit).toHaveBeenCalledWith(
      'tracking',
      expect.objectContaining({ rideId }),
    );
  });
  it('does not query or distribute a location after disconnecting during authentication', async () => {
    const client = socket('pending');
    getUser.mockImplementationOnce(() => {
      client.connected = false;
      gateway.handleDisconnect(client as unknown as Socket);
      return Promise.resolve({
        data: { user: { id: 'actor', user_metadata: {}, app_metadata: {} } },
        error: null,
      } as Awaited<ReturnType<SupabaseService['getUser']>>);
    });
    await gateway.handleConnection(client as unknown as Socket);
    expect(snapshot).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });
  it('revalidates authorization and stops distribution when participation is revoked', async () => {
    const client = socket('revoked');
    await gateway.handleConnection(client as unknown as Socket);
    snapshot.mockRejectedValueOnce(new Error('Forbidden'));
    await jest.advanceTimersByTimeAsync(2000);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(
      client.emit.mock.calls.filter(([event]) => event === 'tracking'),
    ).toHaveLength(1);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
