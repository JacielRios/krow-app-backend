import { PGlite } from '@electric-sql/pglite';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PilotDatabase } from './pilot.database.js';
import { PilotService } from './pilot.service.js';
import type { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { UsersService } from '../users/users.service.js';
import type { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import { AppController } from '../../app.controller.js';
import { PilotNotifications } from './pilot.notifications.js';
import {
  NotificationProviders,
  DeliveryError,
} from '../ride-runtime/infrastructure/notification-providers.js';

class EmbeddedDatabase extends PilotDatabase {
  constructor(readonly postgres: PGlite) {
    super(
      new ConfigService({
        RIDE_PILOT_ENABLED: 'true',
        RIDE_TRACKING_ENABLED: 'true',
        PILOT_ACCOUNT_CLOSURE_ENABLED: 'true',
      }),
    );
  }
  override async query<T extends QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.postgres.query<T>(sql, values)).rows;
  }
  override async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.postgres.transaction(async (tx) =>
      work({
        query: async (sql: string, values: unknown[] = []) => {
          const r = await tx.query(sql, values);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        },
      } as unknown as PoolClient),
    );
  }
}
describe('pilot SQL integration (isolated embedded PostgreSQL)', () => {
  let pg: PGlite, db: EmbeddedDatabase, service: PilotService;
  let maps: GoogleMapsService;
  let driver: AuthenticatedUser,
    passenger: AuthenticatedUser,
    outsider: AuthenticatedUser,
    rideId: string,
    bookingId: string,
    stops: string[];
  const actor = (id: string): AuthenticatedUser => ({
    id,
    email: null,
    accessToken: 'test',
    userMetadata: {},
    appMetadata: {},
  });
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    db = new EmbeddedDatabase(pg);
    await pg.exec(
      await readFile(
        new URL('../../../test/pilot-baseline.sql', import.meta.url),
        'utf8',
      ),
    );
    await pg.exec(
      'alter table public.bookings alter column booking_id set default gen_random_uuid()',
    );
    await pg.exec(
      await readFile(
        new URL('../../../test/pilot-booking-rpc.sql', import.meta.url),
        'utf8',
      ),
    );
    for (const name of [
      '20261006221452_pilot_online.sql',
      '20261006221521_pilot_notifications.sql',
      '20261006221527_pilot_lifecycle_guardrails.sql',
      '20261007002518_pilot_profile_privacy.sql',
    ])
      await pg.exec(
        await readFile(
          new URL(
            '../../../../../supabase/migrations/' + name,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    await pg.exec(
      await readFile(
        new URL(
          '../../../../../supabase/migrations/20261007002528_pilot_api_cutover.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await pg.exec(
      await readFile(
        new URL('../../../test/pilot-legacy-triggers.sql', import.meta.url),
        'utf8',
      ),
    );
    maps = {
      routePreview: () =>
        Promise.resolve({
          encodedPolyline: 'operative',
          durationSeconds: 120,
          distanceMeters: 1500,
          provider: 'google',
          calculatedAt: new Date().toISOString(),
        }),
    } as unknown as GoogleMapsService;
    service = new PilotService(db, maps);
  }, 30000);
  afterAll(async () => {
    await pg?.close();
  });
  afterEach(() => jest.restoreAllMocks());
  beforeEach(async () => {
    driver = actor(randomUUID());
    passenger = actor(randomUUID());
    outsider = actor(randomUUID());
    rideId = randomUUID();
    bookingId = randomUUID();
    stops = [randomUUID(), randomUUID()];
    const driverId = randomUUID(),
      vehicleId = randomUUID();
    for (const u of [driver, passenger, outsider]) {
      await db.query('insert into auth.users values($1)', [u.id]);
      await db.query('insert into public.users(uuid,full_name) values($1,$2)', [
        u.id,
        u.id === driver.id ? 'Conductor sintético' : 'Pasajero sintético',
      ]);
    }
    await db.query(
      'insert into public.driver_profiles(driver_id,user_id) values($1,$2)',
      [driverId, driver.id],
    );
    await db.query(
      "insert into public.vehicles values($1,$2,'Auto','Piloto','TEST-123',3)",
      [vehicleId, driverId],
    );
    await db.query(
      'insert into public.rides(ride_id,driver_id,vehicle_id) values($1,$2,$3)',
      [rideId, driverId, vehicleId],
    );
    for (let i = 0; i < 2; i++)
      await db.query(
        'insert into public.ride_stops(stop_id,ride_id,stop_order,lat,lng,address) values($1,$2,$3,$4,$5,$6)',
        [
          stops[i],
          rideId,
          i + 1,
          25.67 + i * 0.01,
          -100.3 - i * 0.01,
          'Parada sintética ' + i,
        ],
      );
    for (const stop of stops) {
      await db.query('insert into public.transport_stops(stop_id) values($1)', [
        stop,
      ]);
      await db.query(
        'update public.ride_stops set transport_stop_id=$1 where stop_id=$1',
        [stop],
      );
    }
    await db.query(
      "insert into public.bookings(booking_id,ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,$5,'confirmed')",
      [bookingId, rideId, passenger.id, ...stops],
    );
  });
  it('labels a cached route fallback and recovers after the provider retry interval', async () => {
    await service.lifecycle(driver, rideId, 'start');
    const preview = jest.spyOn(maps, 'routePreview');
    preview.mockRejectedValueOnce(new Error('Provider unavailable'));
    const first = await service.snapshot(driver, rideId);
    expect(first.route.error).toContain('ruta publicada');
    expect(first.etaSeconds).toBeNull();
    expect((await service.snapshot(driver, rideId)).route.error).toBe(
      first.route.error,
    );
    expect(preview).toHaveBeenCalledTimes(1);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 15001);
    const recovered = await service.snapshot(driver, rideId);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(recovered.route.polyline).toBe('operative');
    expect(recovered.route.error).toBeNull();
  });
  it('completes the entire ride without auto-boarding or requiring cash', async () => {
    await service.lifecycle(driver, rideId, 'start');
    expect(
      (
        await db.query(
          'select status from public.bookings where booking_id=$1',
          [bookingId],
        )
      )[0].status,
    ).toBe('confirmed');
    await expect(service.lifecycle(driver, rideId, 'complete')).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.attend(driver, rideId, bookingId, 'dropoff'),
    ).rejects.toThrow(ConflictException);
    await service.attend(driver, rideId, bookingId, 'board');
    await service.attend(driver, rideId, bookingId, 'board');
    await service.attend(driver, rideId, bookingId, 'dropoff');
    await service.lifecycle(driver, rideId, 'complete');
    await service.lifecycle(driver, rideId, 'complete');
    const history = await service.history(passenger, rideId);
    expect(history.ride.status).toBe('completed');
    expect(history.bookings[0].cashStatus).toBe('pending');
    await service.collect(driver, bookingId);
    await service.review(passenger, bookingId, 5, 'Buen viaje');
    await expect(
      service.review(passenger, bookingId, 4, 'Otro'),
    ).rejects.toThrow(ConflictException);
    expect(
      (
        await db.query('select rating from public.users where uuid=$1', [
          driver.id,
        ])
      )[0].rating,
    ).toBe('5.00');
  });
  it('uses only the latest reservation after cancellation and rebooking', async () => {
    await service.updateBooking(passenger, bookingId, 'cancelled');
    const dropoff = randomUUID();
    await db.query('insert into public.transport_stops(stop_id) values($1)', [
      dropoff,
    ]);
    await db.query(
      "insert into public.ride_stops(stop_id,ride_id,stop_order,lat,lng,address,transport_stop_id) values($1,$2,3,25.7,-100.32,'Nueva bajada',$1)",
      [dropoff, rideId],
    );
    const next = await db.routeRpc(passenger.id, 'request_booking_v2', [
      {
        ride_id: rideId,
        pickup_stop_id: stops[0],
        dropoff_stop_id: dropoff,
        seats_reserved: 1,
      },
    ]);
    await db.query(
      "update public.bookings set created_at=(select created_at+interval '1 second' from public.bookings where booking_id=$2) where booking_id=$1",
      [next, bookingId],
    );
    await service.updateBooking(driver, String(next), 'confirmed');
    const history = await service.history(passenger, rideId);
    expect(history.bookings).toHaveLength(1);
    expect(history.bookings[0]).toMatchObject({
      bookingId: next,
      status: 'confirmed',
      dropoffAddress: 'Nueva bajada',
    });
    expect(
      await service.activity(passenger, 'passenger', 'upcoming', 0, 30),
    ).toHaveLength(1);
    expect(
      await service.activity(passenger, 'passenger', 'history', 0, 30),
    ).toHaveLength(0);
    expect(await service.rideView(passenger, rideId, false)).toMatchObject({
      role: 'pasajero',
      myBooking: { bookingId: next },
      conductorInfo: { userId: driver.id, fullName: 'Conductor sintético' },
    });
    await service.lifecycle(driver, rideId, 'start');
    expect((await service.snapshot(passenger, rideId)).myStop?.address).toBe(
      'Nueva bajada',
    );
    expect(await service.rideView(passenger, rideId, true)).toMatchObject({
      myBooking: { bookingId: next },
      driver: { userId: driver.id, vehicleLicensePlate: 'TEST-123' },
    });
    await expect(service.rideView(outsider, rideId, true)).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('creates and edits the private profile without exposing metadata or reopening a closed account', async () => {
    await pg.exec(
      await readFile(
        new URL('../../../../../scripts/pilot-role.sql', import.meta.url),
        'utf8',
      ),
    );
    const users = new UsersService({} as SupabaseService, db);
    const fresh = actor(randomUUID());
    fresh.email = 'test-' + fresh.id + '@example.invalid';
    fresh.userMetadata = {
      full_name: 'Perfil nuevo',
      institutional_id: '',
      academic_program: 'Ingeniería',
      academic_period: '3',
    };
    await db.query('insert into auth.users values($1)', [fresh.id]);
    await pg.exec('set role krow_pilot_service');
    try {
      expect(await users.me(fresh)).toMatchObject({
        userId: fresh.id,
        fullName: 'Perfil nuevo',
        academicPeriod: 3,
      });
      await users.upsertProfile(fresh, {
        fullName: 'Nombre actualizado',
        institutionalId: '',
        academicProgram: 'Ingeniería',
        academicPeriod: 4,
      });
      expect(await users.me(fresh)).toMatchObject({
        fullName: 'Nombre actualizado',
        academicPeriod: 4,
      });
      await service.requestClosure(fresh);
      await expect(
        users.upsertProfile(fresh, {
          fullName: 'Intento',
          institutionalId: '',
          academicProgram: '',
        }),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await pg.exec('reset role');
    }
  });
  it('refuses readiness for a private login missing the new profile grants and recovers after grant repair', async () => {
    await pg.exec(
      await readFile(
        new URL('../../../../../scripts/pilot-role.sql', import.meta.url),
        'utf8',
      ),
    );
    const health = new AppController(db);
    await pg.exec('set role krow_pilot_service');
    try {
      expect(await health.ready()).toEqual({ status: 'ok', pilot: 'ready' });
    } finally {
      await pg.exec('reset role');
    }
    await pg.exec(
      'revoke update(academic_program) on public.users from krow_pilot_service',
    );
    await pg.exec('set role krow_pilot_service');
    try {
      await expect(health.ready()).rejects.toThrow(ServiceUnavailableException);
    } finally {
      await pg.exec('reset role');
    }
    await pg.exec(
      'grant update(academic_program) on public.users to krow_pilot_service',
    );
    await pg.exec('set role krow_pilot_service');
    try {
      expect(await health.ready()).toEqual({ status: 'ok', pilot: 'ready' });
    } finally {
      await pg.exec('reset role');
    }
  });
  it('executes the audited booking RPC with actor ownership and a committed price', async () => {
    await pg.exec(
      await readFile(
        new URL('../../../../../scripts/pilot-role.sql', import.meta.url),
        'utf8',
      ),
    );
    const payload = {
      ride_id: rideId,
      pickup_stop_id: stops[0],
      dropoff_stop_id: stops[1],
      seats_reserved: 1,
    };
    const created = await db.routeRpc(outsider.id, 'request_booking_v2', [
      payload,
    ]);
    expect(
      (
        await db.query(
          'select user_id,status from public.bookings where booking_id=$1',
          [created],
        )
      )[0],
    ).toMatchObject({ user_id: outsider.id, status: 'pending' });
    expect(
      (
        await db.query(
          'select amount_cents from krow_pilot.booking_prices where booking_id=$1',
          [created],
        )
      )[0].amount_cents,
    ).toBe(1234);
    await expect(
      db.routeRpc(outsider.id, 'request_booking_v2', [payload]),
    ).rejects.toThrow(ConflictException);
    await expect(
      db.routeRpc(driver.id, 'request_booking_v2', [payload]),
    ).rejects.toThrow(ForbiddenException);
  });
  it('keeps passenger tracking private, rejects old positions and revokes at dropoff', async () => {
    await service.lifecycle(driver, rideId, 'start');
    const session = await service.openSession(driver, rideId, randomUUID());
    const sample = {
      seq: 1,
      capturedAt: new Date().toISOString(),
      lat: 25.67,
      lng: -100.3,
      accuracy: 12,
    };
    await service.upload(rideId, session.sessionId, session.uploadToken, [
      sample,
    ]);
    expect(
      (await service.snapshot(driver, rideId)).nextStop?.pickups[0].bookingId,
    ).toBe(bookingId);
    const own = await service.snapshot(passenger, rideId);
    expect(own.stops).toEqual([]);
    expect(own.nextStop).toBeNull();
    expect(own.myStop?.address).toContain('1');
    expect(own.myPickup?.address).toContain('0');
    expect(own.nextAction).toBe('pickup');
    await expect(service.snapshot(outsider, rideId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(
      (
        await service.upload(rideId, session.sessionId, session.uploadToken, [
          sample,
        ])
      ).acknowledgedSeq,
    ).toBe(1);
    expect(
      (
        await service.upload(rideId, session.sessionId, session.uploadToken, [
          {
            ...sample,
            seq: 2,
            capturedAt: new Date(
              Date.parse(sample.capturedAt) - 1000,
            ).toISOString(),
            lat: 25.5,
          },
        ])
      ).acknowledgedSeq,
    ).toBe(2);
    expect((await service.snapshot(driver, rideId)).position?.lat).toBe(
      sample.lat,
    );
    await service.attend(driver, rideId, bookingId, 'board');
    expect((await service.snapshot(passenger, rideId)).nextAction).toBe(
      'dropoff',
    );
    expect(
      (await service.snapshot(driver, rideId)).nextStop?.dropoffs[0].bookingId,
    ).toBe(bookingId);
    await service.attend(driver, rideId, bookingId, 'dropoff');
    await expect(service.snapshot(passenger, rideId)).rejects.toThrow(
      ForbiddenException,
    );
    await service.lifecycle(driver, rideId, 'complete');
    expect(
      await db.query(
        'select * from krow_pilot.tracking_sessions where ride_id=$1',
        [rideId],
      ),
    ).toHaveLength(0);
    await expect(
      service.upload(rideId, session.sessionId, session.uploadToken, [sample]),
    ).rejects.toThrow(ForbiddenException);
  });
  it('enforces chat ownership, idempotency and terminal read-only access', async () => {
    const clientId = randomUUID();
    await service.send(
      passenger,
      bookingId,
      clientId,
      'Nos vemos en la parada',
    );
    await service.send(
      passenger,
      bookingId,
      clientId,
      'Nos vemos en la parada',
    );
    expect((await service.messages(driver, bookingId)).messages).toHaveLength(
      1,
    );
    await expect(service.messages(outsider, bookingId)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.collect(passenger, bookingId)).rejects.toThrow(
      ForbiddenException,
    );
    await service.lifecycle(driver, rideId, 'start');
    await service.attend(driver, rideId, bookingId, 'no-show');
    await service.lifecycle(driver, rideId, 'complete');
    expect((await service.messages(passenger, bookingId)).canWrite).toBe(false);
    await expect(
      service.send(driver, bookingId, randomUUID(), 'Nuevo'),
    ).rejects.toThrow(ConflictException);
  });
  it('lists completed passenger bookings while the driver is still in progress', async () => {
    await service.lifecycle(driver, rideId, 'start');
    await service.attend(driver, rideId, bookingId, 'board');
    await service.attend(driver, rideId, bookingId, 'dropoff');
    expect(
      (await service.activity(passenger, 'passenger', 'history', 0, 30))[0]
        .bookingId,
    ).toBe(bookingId);
    expect(
      await service.activity(passenger, 'passenger', 'active', 0, 30),
    ).toHaveLength(0);
  });
  it('captures cents at reservation time and refuses inactive drivers', async () => {
    await db.query(
      'update public.rides set price_per_seat=99 where ride_id=$1',
      [rideId],
    );
    expect((await service.cash(passenger, bookingId)).amountCents).toBe(1234);
    await db.query('update public.users set is_active=false where uuid=$1', [
      driver.id,
    ]);
    await expect(service.lifecycle(driver, rideId, 'start')).rejects.toThrow();
  });
  it('refuses starting after driver suspension or vehicle deactivation while allowing an already active trip to finish', async () => {
    await db.query(
      "update public.driver_profiles set status='suspended' where user_id=$1",
      [driver.id],
    );
    await expect(service.lifecycle(driver, rideId, 'start')).rejects.toThrow(
      ForbiddenException,
    );
    await db.query(
      "update public.driver_profiles set status='approved' where user_id=$1",
      [driver.id],
    );
    await db.query(
      'update public.vehicles set is_active=false where vehicle_id=(select vehicle_id from public.rides where ride_id=$1)',
      [rideId],
    );
    await expect(service.lifecycle(driver, rideId, 'start')).rejects.toThrow(
      ConflictException,
    );
    await db.query(
      'update public.vehicles set is_active=true where vehicle_id=(select vehicle_id from public.rides where ride_id=$1)',
      [rideId],
    );
    await service.lifecycle(driver, rideId, 'start');
    await db.query(
      "update public.driver_profiles set status='suspended' where user_id=$1",
      [driver.id],
    );
    await service.attend(driver, rideId, bookingId, 'board');
    await service.attend(driver, rideId, bookingId, 'dropoff');
    await service.lifecycle(driver, rideId, 'complete');
  });
  it('prioritizes an ongoing trip over a newer published trip and forbids a second simultaneous start', async () => {
    await service.lifecycle(driver, rideId, 'start');
    const nextRide = randomUUID();
    await db.query(
      "insert into public.rides(ride_id,driver_id,vehicle_id,departure_time) select $2,driver_id,vehicle_id,now()+interval '1 hour' from public.rides where ride_id=$1",
      [rideId, nextRide],
    );
    expect(await service.activeRide(driver, 'driver')).toMatchObject({
      rideId,
      status: 'in_progress',
      role: 'driver',
    });
    await expect(service.lifecycle(driver, nextRide, 'start')).rejects.toThrow(
      ConflictException,
    );
    expect((await service.snapshot(passenger, rideId)).observedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await service.attend(driver, rideId, bookingId, 'board');
    await service.attend(driver, rideId, bookingId, 'dropoff');
    await service.lifecycle(driver, rideId, 'complete');
    await service.lifecycle(driver, nextRide, 'start');
    expect(await service.activeRide(driver, 'driver')).toMatchObject({
      rideId: nextRide,
      status: 'in_progress',
    });
  });
  it('paginates equal-timestamp messages without losing or duplicating rows', async () => {
    for (let i = 0; i < 85; i++)
      await db.query(
        "insert into krow_pilot.messages(booking_id,sender_id,client_id,body,created_at) values($1,$2,$3,$4,'2026-10-06T18:00:00.123456Z')",
        [bookingId, passenger.id, randomUUID(), 'Mensaje ' + i],
      );
    const a = await service.messages(passenger, bookingId);
    const b = await service.messages(passenger, bookingId, a.nextCursor!);
    const c = await service.messages(passenger, bookingId, b.nextCursor!);
    expect(
      new Set(
        [...a.messages, ...b.messages, ...c.messages].map((m) =>
          String(m.messageId),
        ),
      ).size,
    ).toBe(85);
    expect(c.nextCursor).toBeNull();
  });
  it('rejects JS-parseable but invalid SQL timestamps before executing a chat query', async () => {
    for (const at of ['1', '2026-02-31T12:00:00.123456Z']) {
      const cursor = Buffer.from(
        JSON.stringify({ at, id: randomUUID() }),
      ).toString('base64url');
      await expect(
        service.messages(passenger, bookingId, cursor),
      ).rejects.toThrow(BadRequestException);
    }
  });
  it('reserves the last seat and prevents confirmations or cancellation after start', async () => {
    await db.query(
      "update public.bookings set status='pending' where booking_id=$1",
      [bookingId],
    );
    await db.query(
      'update public.rides set available_seats=1 where ride_id=$1',
      [rideId],
    );
    await expect(service.lifecycle(driver, rideId, 'start')).rejects.toThrow(
      ConflictException,
    );
    expect(
      (
        await db.query(
          'select status from public.bookings where booking_id=$1',
          [bookingId],
        )
      )[0].status,
    ).toBe('pending');
    await expect(
      service.updateBooking(passenger, bookingId, 'confirmed'),
    ).rejects.toThrow(ForbiddenException);
    await service.updateBooking(driver, bookingId, 'confirmed');
    await service.updateBooking(driver, bookingId, 'confirmed');
    expect(
      (
        await db.query(
          'select available_seats,status from public.rides where ride_id=$1',
          [rideId],
        )
      )[0],
    ).toMatchObject({ available_seats: 0, status: 'full' });
    await service.lifecycle(driver, rideId, 'start');
    await expect(
      service.updateBooking(passenger, bookingId, 'cancelled'),
    ).rejects.toThrow(ConflictException);
  });
  it('denies Data API access to private tables and business routing RPCs', async () => {
    await pg.exec(
      await readFile(
        new URL('../../../../../scripts/pilot-role.sql', import.meta.url),
        'utf8',
      ),
    );
    await pg.exec('set role authenticated');
    try {
      await expect(
        db.query('select * from krow_pilot.tracking_sessions'),
      ).rejects.toThrow();
      await expect(
        db.query("select public.create_ride_v2('{}'::jsonb)"),
      ).rejects.toThrow();
    } finally {
      await pg.exec('reset role');
    }
    await pg.exec('set role krow_pilot_service');
    try {
      await service.lifecycle(driver, rideId, 'start');
      await service.attend(driver, rideId, bookingId, 'board');
      await service.attend(driver, rideId, bookingId, 'dropoff');
      await service.lifecycle(driver, rideId, 'complete');
      await service.collect(driver, bookingId);
      await service.review(passenger, bookingId, 5, '');
    } finally {
      await pg.exec('reset role');
    }
  });
  it('protects push registration ownership and keeps a token renewed during an invalid-token response', async () => {
    const deviceId = randomUUID();
    const push = jest.fn(async () => {
      await notifications.register(
        driver.id,
        deviceId,
        'renewed-token-for-this-account',
      );
      throw new DeliveryError('UNREGISTERED', true);
    });
    const notifications = new PilotNotifications(
      db,
      new ConfigService({
        PILOT_PUSH_ENABLED: 'true',
        PILOT_PUSH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      }),
      { push } as unknown as NotificationProviders,
    );
    await notifications.register(
      driver.id,
      deviceId,
      'initial-token-for-this-account',
    );
    await expect(
      notifications.register(
        outsider.id,
        deviceId,
        'token-for-the-wrong-account',
      ),
    ).rejects.toThrow(ForbiddenException);
    const original = (
      await db.query<{ token_encrypted: string }>(
        'select token_encrypted from krow_pilot.devices where device_id=$1',
        [deviceId],
      )
    )[0].token_encrypted;
    await db.query('delete from krow_pilot.outbox');
    await db.query(
      "insert into krow_pilot.outbox(event_key,ride_id,booking_id,recipient_id,kind) values('rotation-check',$1,$2,$3,'booking')",
      [rideId, bookingId, driver.id],
    );
    await notifications.dispatch();
    expect(push).toHaveBeenCalledTimes(1);
    const devices = await db.query<{
      actor_id: string;
      token_encrypted: string;
    }>(
      'select actor_id,token_encrypted from krow_pilot.devices where device_id=$1',
      [deviceId],
    );
    expect(devices).toHaveLength(1);
    expect(devices[0].actor_id).toBe(driver.id);
    expect(devices[0].token_encrypted).not.toBe(original);
    expect(devices[0].token_encrypted).not.toContain('renewed-token');
    await service.requestClosure(outsider);
    await expect(
      notifications.register(
        outsider.id,
        randomUUID(),
        'token-from-a-closed-account',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('blocks account closure during a trip and queues data processing separately', async () => {
    await expect(service.requestClosure(passenger)).rejects.toThrow(
      ConflictException,
    );
    expect(await service.requestClosure(outsider)).toEqual({
      status: 'access_closed',
      dataProcessing: 'pending_policy',
    });
    expect(
      (
        await db.query('select is_active from public.users where uuid=$1', [
          outsider.id,
        ])
      )[0].is_active,
    ).toBe(false);
    expect(
      (
        await db.query(
          'select status from krow_pilot.account_closure_requests where actor_id=$1',
          [outsider.id],
        )
      )[0].status,
    ).toBe('access_closed');
  });
  it('allows own profile edits without permitting reactivation or driver approval', async () => {
    await service.requestClosure(outsider);
    await pg.exec('set role authenticated');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        outsider.id,
      ]);
      await db.query('update public.users set full_name=$2 where uuid=$1', [
        outsider.id,
        'Nombre editado',
      ]);
      await expect(
        db.query('update public.users set is_active=true where uuid=$1', [
          outsider.id,
        ]),
      ).rejects.toThrow();
      await expect(
        db.query('update public.users set rating=5 where uuid=$1', [
          outsider.id,
        ]),
      ).rejects.toThrow();
      await expect(
        db.query(
          'select email_address,academic_program,institutional_id from public.users where uuid=$1',
          [outsider.id],
        ),
      ).rejects.toThrow();
      await expect(db.query('truncate public.users cascade')).rejects.toThrow();
      await expect(
        db.query(
          "update public.driver_profiles set status='approved' where user_id=$1",
          [outsider.id],
        ),
      ).rejects.toThrow();
      expect(
        await db.query('select uuid from public.users where uuid=$1', [
          passenger.id,
        ]),
      ).toHaveLength(0);
    } finally {
      await pg.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  });
});
