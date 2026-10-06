import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  Server as SocketServer,
  type Socket as UntypedSocket,
} from 'socket.io';
import type { DefaultEventsMap } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import { RuntimeService } from '../application/runtime.service.js';
import { TrackingService } from '../application/tracking.service.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LocationBatchDto } from './runtime.dto.js';
import { isUUID } from 'class-validator';
import type { VehiclePosition } from '../domain/protocol.js';
type SocketData = { actor: string; rideId: string };
type Socket = UntypedSocket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;
type Server = SocketServer<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

@Injectable()
export class RuntimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeGateway.name);
  private server?: Server;
  private subscriber?: Awaited<ReturnType<RuntimeStreams['redis']>>;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly rooms = new Map<string, Set<Socket>>();
  private readonly positions = new Map<string, VehiclePosition>();
  private readonly delivering = new Set<string>();
  constructor(
    private readonly http: HttpAdapterHost,
    private readonly auth: SupabaseService,
    private readonly streams: RuntimeStreams,
    private readonly runtime: RuntimeService,
    private readonly tracking: TrackingService,
  ) {}
  async onModuleInit() {
    if (!this.streams.enabled || this.streams.worker) return;
    this.server = new SocketServer<
      DefaultEventsMap,
      DefaultEventsMap,
      DefaultEventsMap,
      SocketData
    >(this.http.httpAdapter.getHttpServer() as HttpServer, {
      path: '/v2/socket.io',
      transports: ['websocket'],
      maxHttpBufferSize: 65536,
      serveClient: false,
      pingInterval: 20000,
      pingTimeout: 15000,
    });
    this.server.use((socket, next) => {
      void this.authenticate(socket)
        .then(() => next())
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
    this.server.on('connection', (socket) => {
      const actor = socket.data.actor,
        rideId = socket.data.rideId;
      // Force fresh authentication periodically; the client supplies its refreshed token.
      const timer = setTimeout(
        () => socket.disconnect(true),
        240000 + Math.random() * 60000,
      );
      const room = this.rooms.get(rideId) ?? new Set<Socket>();
      room.add(socket);
      this.rooms.set(rideId, room);
      this.timers.set(socket.id, timer);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        this.timers.delete(socket.id);
        room.delete(socket);
        if (!room.size) {
          this.rooms.delete(rideId);
          this.positions.delete(rideId);
        }
      });
      let pending = false;
      socket.on('locations', (body: unknown, ack: (value: unknown) => void) => {
        if (typeof ack !== 'function') return;
        if (pending) {
          ack({ ok: false, code: 'BUSY' });
          return;
        }
        pending = true;
        void (async () => {
          const dto = plainToInstance(LocationBatchDto, body);
          if (
            await validate(dto, {
              whitelist: true,
              forbidNonWhitelisted: true,
            }).then((errors) => errors.length)
          )
            throw new Error('INVALID_BATCH');
          await this.tracking.ingest(actor, rideId, dto.samples);
          ack({ ok: true });
        })()
          .catch(() => ack({ ok: false, code: 'RETRY_HTTP' }))
          .finally(() => {
            pending = false;
          });
      });
    });
    this.subscriber = await this.streams.createSubscriber();
    this.subscriber.on('ready', () => {
      // Pub/sub has no replay. Fetch an authorized snapshot after every recovery.
      for (const [rideId, sockets] of this.rooms)
        for (const socket of sockets) socket.emit('ride.changed', { rideId });
    });
    await this.subscriber.connect();
    await this.subscriber.subscribe('krow:positions', (message) => {
      try {
        const event = JSON.parse(message) as {
          rideId: string;
          position: VehiclePosition;
        };
        if (this.rooms.has(event.rideId)) {
          this.positions.set(event.rideId, event.position);
          this.pump();
        }
      } catch {
        this.logger.warn('invalid_position_event');
      }
    });
    await this.subscriber.subscribe('krow:business', (message) => {
      try {
        const event = JSON.parse(message) as { rideId: string };
        // Invalidation contains no sensitive passenger data. Authorization is rechecked
        // before every position delivery, including during cancellation/termination.
        for (const socket of this.rooms.get(event.rideId) ?? [])
          socket.emit('ride.changed', event);
      } catch {
        this.logger.warn('invalid_business_event');
      }
    });
  }
  private pump() {
    for (const [rideId, position] of this.positions) {
      if (this.delivering.size >= 16) return;
      if (this.delivering.has(rideId)) continue;
      this.positions.delete(rideId);
      this.delivering.add(rideId);
      void this.deliver(rideId, 'position', position).finally(() => {
        this.delivering.delete(rideId);
        this.pump();
      });
    }
  }
  private async authenticate(socket: Socket) {
    const { token, rideId } = socket.handshake.auth as {
      token?: string;
      rideId?: string;
    };
    if (!token || !rideId || !isUUID(rideId))
      throw new Error('UNAUTHENTICATED');
    const { data, error } = await this.auth.getUser(token);
    if (error || !data.user) throw new Error('UNAUTHENTICATED');
    await this.runtime.authorize(data.user.id, rideId);
    socket.data.actor = data.user.id;
    socket.data.rideId = rideId;
  }
  private async deliver(rideId: string, event: string, value: unknown) {
    const sockets = [...(this.rooms.get(rideId) ?? [])];
    if (!sockets.length) return;
    // One indexed membership query per ride per gateway, not per passenger.
    try {
      const participants = await this.runtime.db.query<{ user_id: string }>(
        `select d.user_id from krow_runtime.rides rt join public.rides r using(ride_id) join public.driver_profiles d using(driver_id) where rt.ride_id=$1 and rt.state in ('scheduled','in_progress')
        union select b.user_id from public.bookings b join krow_runtime.rides rt using(ride_id) where b.ride_id=$1 and b.status in ('confirmed','in_progress') and rt.state in ('scheduled','in_progress')`,
        [rideId],
      );
      const allowed = new Set(participants.map((p) => p.user_id));
      for (const socket of sockets)
        if (allowed.has(socket.data.actor)) socket.volatile.emit(event, value);
        else socket.disconnect(true);
    } catch {
      /* fail closed; HTTPS recovery fetches an authorized snapshot */
    }
  }
  async onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.subscriber?.destroy();
    await this.server?.close();
  }
}
