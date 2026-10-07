import {
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import { PilotService } from './pilot.service.js';

@WebSocketGateway({
  namespace: '/v1/tracking',
  transports: ['websocket'],
  maxHttpBufferSize: 4096,
})
export class PilotGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly connections = new Map<string, string | null>();
  constructor(
    private readonly pilot: PilotService,
    private readonly supabase: SupabaseService,
  ) {}
  async handleConnection(socket: Socket) {
    const token: unknown = socket.handshake.auth.token;
    const rideId: unknown = socket.handshake.auth.rideId;
    if (
      typeof token !== 'string' ||
      token.length > 8192 ||
      typeof rideId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(rideId) ||
      this.connections.size >= 512
    ) {
      socket.disconnect(true);
      return;
    }
    // Reserve capacity before asynchronous authentication. Each account can
    // follow at most three sockets; REST remains available during reconnects.
    this.connections.set(socket.id, null);
    const tick = async () => {
      if (!socket.connected || !this.connections.has(socket.id)) return;
      try {
        // Revalidate token and participation for every distribution. No shared
        // room can accidentally expose another passenger's personal stop.
        const { data, error } = await this.supabase.getUser(token);
        if (error || !data.user) throw new Error('Sesión expirada');
        if (!socket.connected || !this.connections.has(socket.id)) return;
        const owner = this.connections.get(socket.id);
        if (owner === null) {
          let count = 0;
          for (const actor of this.connections.values())
            if (actor === data.user.id) count++;
          if (count >= 3) throw new Error('Demasiadas conexiones');
          this.connections.set(socket.id, data.user.id);
        } else if (owner !== data.user.id) {
          throw new Error('La identidad de la sesión cambió');
        }
        const snapshot = await this.pilot.snapshot(
          {
            id: data.user.id,
            email: data.user.email ?? null,
            accessToken: token,
            userMetadata: data.user.user_metadata,
            appMetadata: data.user.app_metadata,
          },
          rideId,
        );
        if (socket.connected && this.connections.has(socket.id))
          socket.emit('tracking', snapshot);
      } catch {
        socket.emit('unavailable', {
          message: 'Actualiza el viaje para verificar el acceso al GPS',
        });
        socket.disconnect(true);
        this.handleDisconnect(socket);
        return;
      }
      if (socket.connected && this.connections.has(socket.id))
        this.timers.set(
          socket.id,
          setTimeout(() => void tick(), 2000),
        );
    };
    await tick();
  }
  handleDisconnect(socket: Socket) {
    clearTimeout(this.timers.get(socket.id));
    this.timers.delete(socket.id);
    this.connections.delete(socket.id);
  }
  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.connections.clear();
  }
}
