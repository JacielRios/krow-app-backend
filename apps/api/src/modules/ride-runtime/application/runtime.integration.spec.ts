import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { jest } from '@jest/globals';
import { NotificationsService } from './notifications.service.js';
import { RuntimeWorker } from './runtime.worker.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import { TrackingService } from './tracking.service.js';
import { NotificationProviders } from '../infrastructure/notification-providers.js';
import { RuntimeDatabase } from '../infrastructure/runtime-database.js';
import { RuntimeService } from './runtime.service.js';
import type { NavigationRoute, RuntimeAction } from '../domain/protocol.js';

const databaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration(
  'runtime PostgreSQL transactions (isolated temporary database)',
  () => {
    const databaseName = `krow_test_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool, db: RuntimeDatabase, service: RuntimeService;
    let driver: string, rideId: string, stops: string[];
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: databaseUrl });
      await admin.query(`create database ${databaseName}`);
      const url = new URL(databaseUrl!);
      url.pathname = `/${databaseName}`;
      db = new RuntimeDatabase(
        new ConfigService({
          RIDE_RUNTIME_ENABLED: 'true',
          RUNTIME_DATABASE_URL: url.toString(),
        }),
      );
      service = new RuntimeService(db);
      await db.query(
        await readFile(
          new URL('../../../../test/runtime-baseline.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.query(
        await readFile(
          new URL(
            '../../../../../../supabase/migrations/20260928170611_ride_runtime_v2.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await db.query(
        await readFile(
          new URL(
            '../../../../../../scripts/runtime-role.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    }, 30000);
    afterAll(async () => {
      await db?.onModuleDestroy();
      if (admin) {
        await admin.query(
          `drop database if exists ${databaseName} with (force)`,
        );
        await admin.end();
      }
    });
    beforeEach(async () => {
      driver = randomUUID();
      rideId = randomUUID();
      stops = [randomUUID(), randomUUID(), randomUUID()];
      const driverId = randomUUID(),
        vehicleId = randomUUID();
      await db.query('insert into public.users values($1)', [driver]);
      await db.query('insert into public.driver_profiles values($1,$2)', [
        driverId,
        driver,
      ]);
      await db.query('insert into public.vehicles values($1,$2,3)', [
        vehicleId,
        driverId,
      ]);
      await db.query(
        'insert into public.rides(ride_id,driver_id,vehicle_id,available_seats) values($1,$2,$3,2)',
        [rideId, driverId, vehicleId],
      );
      for (let i = 0; i < stops.length; i++) {
        await db.query(
          'insert into public.transport_stops(stop_id) values($1)',
          [stops[i]],
        );
        await db.query(
          'insert into public.ride_stops(stop_id,ride_id,transport_stop_id,stop_order,lat,lng,address) values($1,$2,$1,$3,19,-99,$4)',
          [stops[i], rideId, i + 1, `Stop ${i + 1}`],
        );
      }
      await service.enroll(driver, rideId);
    });
    const passenger = async () => {
      const id = randomUUID();
      await db.query('insert into public.users values($1)', [id]);
      return id;
    };
    const request = async (actor: string, pickup = 0, dropoff = 2, seats = 2) =>
      service.requestBooking(actor, rideId, {
        commandId: randomUUID(),
        pickupStopId: stops[pickup],
        dropoffStopId: stops[dropoff],
        seats,
      });
    const command = async (
      action: RuntimeAction,
      bookingId?: string,
      stopId?: string,
      reason?: string,
    ) => {
      const snapshot = await service.snapshot(driver, rideId);
      return service.command(driver, rideId, {
        commandId: randomUUID(),
        expectedVersion: snapshot.version,
        action,
        bookingId,
        stopId,
        reason,
      });
    };
    const accept = async (bookingId: string) =>
      command('accept_booking', bookingId);
    it('discards a terminated transaction connection without masking the original error', async () => {
      const failure = new Error('transaction interrupted before confirmation');
      await expect(
        db.transaction(async (client) => {
          client.on('error', () => undefined);
          const pid = (
            await client.query<{ pid: number }>('select pg_backend_pid() pid')
          ).rows[0].pid;
          await admin.query('select pg_terminate_backend($1)', [pid]);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect((await service.snapshot(driver, rideId)).state).toBe('scheduled');
    });
    it('deduplicates cancellation notices and excludes previously cancelled passengers', async () => {
      const p = await passenger(),
        q = await passenger();
      const a = await request(p, 0, 2, 1),
        b = await request(q, 0, 2, 1);
      await accept(a.bookingId as string);
      await accept(b.bookingId as string);
      await service.command(q, rideId, {
        commandId: randomUUID(),
        expectedVersion: (await service.snapshot(q, rideId)).version,
        action: 'cancel_booking',
        bookingId: b.bookingId as string,
      });
      await command('cancel');
      const events = await db.query<{
        eventId: string;
        rideId: string;
        version: number;
        type: string;
        occurredAt: string;
      }>(
        `select event_id "eventId",ride_id "rideId",version,type,occurred_at "occurredAt" from krow_runtime.outbox_events where ride_id=$1 and type='ride.cancel'`,
        [rideId],
      );
      const streams = {
        redis: () => Promise.resolve({ publish: () => Promise.resolve(1) }),
      } as unknown as RuntimeStreams;
      const worker = new RuntimeWorker(db, streams, {} as TrackingService);
      await worker.project(events[0]);
      await worker.project(events[0]);
      const intents = await db.query<{ recipient_id: string }>(
        'select recipient_id from krow_runtime.notification_intents where ride_id=$1',
        [rideId],
      );
      expect(intents.map((n) => n.recipient_id)).toEqual([p]);
    });
    it('expires served-stop notices before push and audits human safety acknowledgement', async () => {
      const p = await passenger(),
        b = await request(p);
      await accept(b.bookingId as string);
      const config = new ConfigService({
        RUNTIME_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      });
      const providers = new NotificationProviders(config);
      const push = jest
        .spyOn(providers, 'push')
        .mockResolvedValue('provider-accepted');
      jest.spyOn(providers, 'escalate').mockResolvedValue(undefined);
      const notifications = new NotificationsService(
        service,
        {} as RuntimeStreams,
        providers,
        config,
      );
      await notifications.register(p, randomUUID(), 'android', 'test-token');
      await db.query(
        "insert into krow_runtime.notification_intents(ride_id,recipient_id,event_key,kind,expires_at) values($1,$2,$3,'proximity',now()+interval '60 seconds')",
        [rideId, p, `${rideId}:${stops[0]}:pickup`],
      );
      await db.query(
        "update krow_runtime.stop_visits set state='servicing' where ride_id=$1 and stop_id=$2",
        [rideId, stops[0]],
      );
      await notifications.dispatch();
      expect(push).not.toHaveBeenCalled();
      const incidentId = randomUUID(),
        operator = await passenger();
      expect(
        (await notifications.incident(p, rideId, incidentId, 'critical'))
          .humanAcknowledged,
      ).toBe(false);
      await notifications.incidentAction(operator, incidentId, 'acknowledged');
      expect(
        (await notifications.incident(p, rideId, incidentId, 'critical'))
          .humanAcknowledged,
      ).toBe(true);
      await expect(
        notifications.incidentAction(driver, incidentId, 'responding'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        await db.query(
          'select 1 from krow_runtime.incident_audit where incident_id=$1',
          [incidentId],
        ),
      ).toHaveLength(1);
    });
    it('allows disjoint reservations and rejects overlapping capacity', async () => {
      const a = await request(await passenger(), 0, 1),
        b = await request(await passenger(), 1, 2),
        c = await request(await passenger(), 0, 2);
      await accept(a.bookingId as string);
      await accept(b.bookingId as string);
      await expect(accept(c.bookingId as string)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(
        (
          await db.query<{ available: number }>(
            'select available from krow_runtime.ride_segments where ride_id=$1',
            [rideId],
          )
        ).map((s) => s.available),
      ).toEqual([0, 0]);
    });
    it('serializes concurrent acceptance and atomically emits one event', async () => {
      const a = await request(await passenger()),
        b = await request(await passenger());
      const version = (await service.snapshot(driver, rideId)).version;
      const results = await Promise.allSettled(
        [a, b].map((x) =>
          service.command(driver, rideId, {
            commandId: randomUUID(),
            expectedVersion: version,
            action: 'accept_booking',
            bookingId: x.bookingId as string,
          }),
        ),
      );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const events = await db.query(
        'select 1 from krow_runtime.outbox_events where ride_id=$1 and type=$2',
        [rideId, 'ride.accept_booking'],
      );
      expect(events).toHaveLength(1);
    });
    it('replays the same command, detects changed payloads and blocks legacy writes', async () => {
      const p = await passenger(),
        commandId = randomUUID();
      const input = {
        commandId,
        pickupStopId: stops[0],
        dropoffStopId: stops[2],
        seats: 1,
      };
      const first = await service.requestBooking(p, rideId, input);
      expect(await service.requestBooking(p, rideId, input)).toEqual(first);
      await expect(
        service.requestBooking(p, rideId, { ...input, seats: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        db.query(
          "update public.rides set status='completed' where ride_id=$1",
          [rideId],
        ),
      ).rejects.toThrow('API v2');
    });
    it('revokes cancelled passengers and never exposes other bookings', async () => {
      const p = await passenger(),
        q = await passenger(),
        a = await request(p, 0, 2, 1),
        b = await request(q, 0, 2, 1);
      await accept(a.bookingId as string);
      await accept(b.bookingId as string);
      expect((await service.snapshot(p, rideId)).bookings).toHaveLength(1);
      const version = (await service.snapshot(p, rideId)).version;
      await service.command(p, rideId, {
        commandId: randomUUID(),
        expectedVersion: version,
        action: 'cancel_booking',
        bookingId: a.bookingId as string,
      });
      await expect(service.authorize(p, rideId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.snapshot(await passenger(), rideId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('requires explicit boarding/dropoff, preserves stop order and refuses forced completion', async () => {
      const booking = await request(await passenger());
      await accept(booking.bookingId as string);
      const route: NavigationRoute = {
        provider: 'mapbox',
        calculatedAt: new Date().toISOString(),
        geometry: {
          type: 'LineString',
          coordinates: [
            [-99, 19],
            [-99, 20],
          ],
        },
        distanceMeters: 1000,
        durationSeconds: 300,
        stopIds: stops,
        legs: [],
        trafficAvailable: false,
      };
      await service.saveRoute(
        driver,
        rideId,
        (await service.snapshot(driver, rideId)).version,
        route,
        'initial',
      );
      await command('start');
      await expect(command('complete')).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        command('arrive', undefined, stops[2]),
      ).rejects.toBeInstanceOf(ConflictException);
      await command('arrive', undefined, stops[0]);
      await expect(
        command('depart', undefined, stops[0]),
      ).rejects.toBeInstanceOf(ConflictException);
      await command('board', booking.bookingId as string);
      await command('depart', undefined, stops[0]);
      await command('arrive', undefined, stops[1]);
      await command('depart', undefined, stops[1]);
      await command('arrive', undefined, stops[2]);
      await command('dropoff', booking.bookingId as string);
      await command('complete');
      expect((await service.snapshot(driver, rideId)).state).toBe('completed');
    });
    it('enforces one publisher device and protects the private schema', async () => {
      const device = randomUUID();
      const session = await service.openLocationSession(driver, rideId, device);
      expect(await service.openLocationSession(driver, rideId, device)).toEqual(
        session,
      );
      await expect(
        service.openLocationSession(driver, rideId, randomUUID()),
      ).rejects.toBeInstanceOf(ConflictException);
      const grants = await db.query<{ allowed: boolean }>(
        "select has_schema_privilege('authenticated','krow_runtime','USAGE') allowed",
      );
      expect(grants[0].allowed).toBe(false);
      await service.closeLocationSession(driver, rideId, session.sessionId);
      expect(
        (await service.openLocationSession(driver, rideId, randomUUID()))
          .sessionId,
      ).not.toBe(session.sessionId);
    });
    it('allows the dedicated backend role through RLS while denying DDL and private reads to clients', async () => {
      await db.transaction(async (client) => {
        await client.query('set local role krow_runtime_service');
        const rows = await client.query(
          'select * from krow_runtime.ride_segments where ride_id=$1',
          [rideId],
        );
        expect(rows.rows).toHaveLength(2);
        await client.query(
          'update krow_runtime.rides set updated_at=now() where ride_id=$1',
          [rideId],
        );
      });
      await expect(
        db.transaction(async (client) => {
          await client.query('set local role authenticated');
          await client.query('select * from krow_runtime.rides');
        }),
      ).rejects.toThrow('permission denied');
      await expect(
        db.transaction(async (client) => {
          await client.query('set local role krow_runtime_service');
          await client.query('create table public.runtime_forbidden(id int)');
        }),
      ).rejects.toThrow('permission denied');
    });
  },
);
