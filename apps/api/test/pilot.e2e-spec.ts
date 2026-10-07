import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
  type ExecutionContext,
} from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import type { PoolClient, QueryResultRow } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PilotDatabase } from '../src/modules/pilot/pilot.database.js';
import { PilotService } from '../src/modules/pilot/pilot.service.js';
import {
  PilotController,
  PilotUploadController,
} from '../src/modules/pilot/pilot.controller.js';
import { PilotRateLimitGuard } from '../src/modules/pilot/pilot-rate-limit.guard.js';
import { MapsRateLimitGuard } from '../src/modules/maps/presentation/maps-rate-limit.guard.js';
import { PilotNotifications } from '../src/modules/pilot/pilot.notifications.js';
import { RidesController } from '../src/modules/rides/presentation/rides.controller.js';
import { RidesService } from '../src/modules/rides/application/rides.service.js';
import { RideViewsService } from '../src/modules/rides/application/ride-views.service.js';
import { SupabaseAuthGuard } from '../src/modules/auth/presentation/supabase-auth.guard.js';
import type { SupabaseService } from '../src/infrastructure/supabase/supabase.service.js';
import type { RoutesService } from '../src/modules/routes/application/routes.service.js';
import type { GoogleMapsService } from '../src/modules/maps/infrastructure/google-maps.service.js';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter.js';

class FixtureDatabase extends PilotDatabase {
  constructor(readonly postgres: PGlite) {
    super(
      new ConfigService({
        RIDE_PILOT_ENABLED: 'true',
        RIDE_TRACKING_ENABLED: 'true',
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
          const result = await tx.query(sql, values);
          return {
            rows: result.rows,
            rowCount: result.affectedRows ?? result.rows.length,
          };
        },
      } as unknown as PoolClient),
    );
  }
}
// Uses real HTTP controllers, validation, exception mapping and PostgreSQL.
// Auth and the maps provider are test doubles; this does not certify live Auth,
// publication/catalog geometry, physical GPS or FCM delivery.
describe('pilot HTTP contracts', () => {
  let app: INestApplication<Server>, pg: PGlite, db: FixtureDatabase;
  let driver: string,
    passenger: string,
    outsider: string,
    ride: string,
    booking: string;
  const searchRequests: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    db = new FixtureDatabase(pg);
    await pg.exec(
      await readFile(new URL('./pilot-baseline.sql', import.meta.url), 'utf8'),
    );
    for (const name of [
      '20261006221452_pilot_online.sql',
      '20261006221521_pilot_notifications.sql',
      '20261006221527_pilot_lifecycle_guardrails.sql',
      '20261007002518_pilot_profile_privacy.sql',
    ])
      await pg.exec(
        await readFile(
          new URL('../../../supabase/migrations/' + name, import.meta.url),
          'utf8',
        ),
      );
    await pg.exec(
      await readFile(
        new URL(
          '../../../supabase/migrations/20261007002528_pilot_api_cutover.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await pg.exec(
      await readFile(
        new URL('./pilot-legacy-triggers.sql', import.meta.url),
        'utf8',
      ),
    );
    const pilot = new PilotService(db, {
      routePreview: () => Promise.resolve(null),
    } as unknown as GoogleMapsService);
    const module = await Test.createTestingModule({
      controllers: [PilotController, PilotUploadController, RidesController],
      providers: [
        PilotRateLimitGuard,
        MapsRateLimitGuard,
        { provide: PilotService, useValue: pilot },
        { provide: PilotNotifications, useValue: {} },
        {
          provide: RidesService,
          useValue: new RidesService(
            {
              forUser: () => ({
                rpc: (name: string, args: Record<string, unknown>) => {
                  searchRequests.push({ name, args });
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            } as unknown as SupabaseService,
            {} as RoutesService,
            pilot,
          ),
        },
        {
          provide: RideViewsService,
          useValue: new RideViewsService({} as SupabaseService, pilot),
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<{
            headers: { authorization?: string };
            user?: unknown;
          }>();
          const id = req.headers.authorization?.replace('Bearer ', '');
          if (!id) return false;
          req.user = {
            id,
            email: null,
            accessToken: 'synthetic',
            userMetadata: {},
            appMetadata: {},
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(async () => {
    searchRequests.length = 0;
    driver = randomUUID();
    passenger = randomUUID();
    outsider = randomUUID();
    ride = randomUUID();
    booking = randomUUID();
    const d = randomUUID(),
      v = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    for (const id of [driver, passenger, outsider]) {
      await db.query('insert into auth.users values($1)', [id]);
      await db.query('insert into public.users(uuid,full_name) values($1,$2)', [
        id,
        'Cuenta sintética',
      ]);
    }
    await db.query(
      'insert into public.driver_profiles(driver_id,user_id) values($1,$2)',
      [d, driver],
    );
    await db.query(
      "insert into public.vehicles values($1,$2,'Auto','Test','TEST',3)",
      [v, d],
    );
    await db.query(
      'insert into public.rides(ride_id,driver_id,vehicle_id) values($1,$2,$3)',
      [ride, d, v],
    );
    for (const [i, id] of [a, b].entries())
      await db.query(
        'insert into public.ride_stops(stop_id,ride_id,stop_order,lat,lng,address) values($1,$2,$3,25,-100,$4)',
        [id, ride, i + 1, 'Parada sintética'],
      );
    await db.query(
      "insert into public.bookings(booking_id,ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,$5,'confirmed')",
      [booking, ride, passenger, a, b],
    );
  });
  const http = () => request(app.getHttpServer());
  it('defaults omitted trip origin to the Instituto through the HTTP contract', async () => {
    const response = await http()
      .post('/v1/rides/search')
      .set('Authorization', 'Bearer ' + passenger)
      .send({ destination: { lat: 25, lng: -100 } })
      .expect(201);
    expect(response.body).toEqual([]);
    expect(searchRequests).toEqual([
      {
        name: 'search_available_rides_v2',
        args: {
          p_origin_lat: 25.664011,
          p_origin_lng: -100.243225,
          p_destination_lat: 25,
          p_destination_lng: -100,
          p_max_results: 50,
          p_from_time: null,
          p_to_time: null,
          p_max_distance_m: 1000,
        },
      },
    ]);
  });
  it('rejects malformed origin coordinates before the search service', async () => {
    for (const origin of [
      null,
      [],
      {},
      '25,-100',
      { lat: 25 },
      { lat: null, lng: -100 },
    ]) {
      await http()
        .post('/v1/rides/search')
        .set('Authorization', 'Bearer ' + passenger)
        .send({ origin, destination: { lat: 25, lng: -100 } })
        .expect(400);
    }
    expect(searchRequests).toHaveLength(0);
  });
  it('requires valid destination coordinates even when the origin defaults to the Instituto', async () => {
    for (const destination of [
      undefined,
      null,
      [],
      {},
      '25,-100',
      { lng: -100 },
    ]) {
      await http()
        .post('/v1/rides/search')
        .set('Authorization', 'Bearer ' + passenger)
        .send({ destination })
        .expect(400);
    }
    expect(searchRequests).toHaveLength(0);
  });
  it('completes driver/passenger actions through the public HTTP contracts', async () => {
    await http()
      .post(`/v1/rides/${ride}/start`)
      .set('Authorization', 'Bearer ' + passenger)
      .expect(403);
    await http()
      .post(`/v1/rides/${ride}/start`)
      .set('Authorization', 'Bearer ' + driver)
      .expect(201);
    const view = await http()
      .get(`/v1/rides/${ride}/active-view`)
      .set('Authorization', 'Bearer ' + passenger)
      .expect(200);
    expect(view.body).toMatchObject({
      role: 'pasajero',
      driver: {
        userId: driver,
        fullName: 'Cuenta sintética',
        vehicleLicensePlate: 'TEST',
      },
      myBooking: { bookingId: booking },
    });
    await http()
      .post(`/v1/rides/${ride}/complete`)
      .set('Authorization', 'Bearer ' + driver)
      .expect(409);
    await http()
      .post(`/v1/bookings/${booking}/messages`)
      .set('Authorization', 'Bearer ' + passenger)
      .send({ clientId: randomUUID(), body: 'Ya estoy en la parada' })
      .expect(201);
    for (const action of ['board', 'dropoff'])
      await http()
        .post(`/v1/rides/${ride}/stops/${booking}/attend`)
        .set('Authorization', 'Bearer ' + driver)
        .send({ action })
        .expect(201);
    await http()
      .post(`/v1/rides/${ride}/complete`)
      .set('Authorization', 'Bearer ' + driver)
      .expect(201);
    await http()
      .post(`/v1/bookings/${booking}/cash/collect`)
      .set('Authorization', 'Bearer ' + driver)
      .expect(201);
    await http()
      .post(`/v1/bookings/${booking}/review`)
      .set('Authorization', 'Bearer ' + passenger)
      .send({ stars: 5, comment: null })
      .expect(201);
    const history = await http()
      .get(`/v1/rides/${ride}/history`)
      .set('Authorization', 'Bearer ' + passenger)
      .expect(200);
    expect(history.body).toMatchObject({
      role: 'passenger',
      ride: { status: 'completed' },
      bookings: [
        {
          status: 'completed',
          cashStatus: 'collected',
          myReview: 5,
          amountCents: 1234,
        },
      ],
    });
    await http()
      .get(`/v1/rides/${ride}/history`)
      .set('Authorization', 'Bearer ' + outsider)
      .expect(403);
  });
  it('validates scoped GPS credentials and removes passenger access on dropoff', async () => {
    await http()
      .post(`/v1/rides/${ride}/start`)
      .set('Authorization', 'Bearer ' + driver)
      .expect(201);
    const session = await http()
      .post(`/v1/rides/${ride}/tracking/sessions`)
      .set('Authorization', 'Bearer ' + driver)
      .send({ deviceId: randomUUID() })
      .expect(201);
    const response = session.body as {
      sessionId: string;
      uploadToken: string;
    };
    const credential = {
      sessionId: response.sessionId,
      uploadToken: response.uploadToken,
    };
    await http()
      .post(`/v1/rides/${ride}/tracking/locations`)
      .send({
        ...credential,
        samples: [
          {
            seq: 1,
            capturedAt: new Date().toISOString(),
            lat: 25,
            lng: -100,
            accuracy: 10,
          },
        ],
      })
      .expect(201);
    await http()
      .post(`/v1/rides/${ride}/tracking/locations`)
      .send({
        ...credential,
        samples: [
          {
            seq: 2,
            capturedAt: new Date().toISOString(),
            lat: 99,
            lng: -100,
            accuracy: 10,
          },
        ],
      })
      .expect(400);
    await http()
      .get(`/v1/rides/${ride}/tracking`)
      .set('Authorization', 'Bearer ' + passenger)
      .expect(200);
    for (const action of ['board', 'dropoff'])
      await http()
        .post(`/v1/rides/${ride}/stops/${booking}/attend`)
        .set('Authorization', 'Bearer ' + driver)
        .send({ action })
        .expect(201);
    await http()
      .get(`/v1/rides/${ride}/tracking`)
      .set('Authorization', 'Bearer ' + passenger)
      .expect(403);
  });
});
