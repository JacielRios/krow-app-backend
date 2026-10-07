import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PilotDatabase } from './pilot.database.js';
import { PilotService } from './pilot.service.js';
import type { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';

// Requires an explicitly supplied test server with CREATE DATABASE/ROLE.
// All tables are created inside a uniquely named temporary database.
const testUrl = process.env.TEST_PILOT_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;
integration('pilot real PostgreSQL concurrency and private login', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `krow_pilot_test_${suffix}`;
  const loginName = `krow_pilot_login_${suffix}`;
  let admin: pg.Pool, owner: pg.Pool, db: PilotDatabase, service: PilotService;
  let databaseCreated = false,
    loginCreated = false;
  const actor = (id: string): AuthenticatedUser => ({
    id,
    email: null,
    accessToken: 'synthetic',
    userMetadata: {},
    appMetadata: {},
  });
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testUrl });
    await admin.query(`create database ${databaseName}`);
    databaseCreated = true;
    const ownerUrl = new URL(testUrl!);
    ownerUrl.pathname = '/' + databaseName;
    owner = new pg.Pool({ connectionString: ownerUrl.toString() });
    const fixture = await readFile(
      new URL('../../../test/pilot-baseline.sql', import.meta.url),
      'utf8',
    );
    await owner.query(
      fixture.replace(
        'create role anon; create role authenticated;',
        `do $$ begin
      begin create role anon; exception when duplicate_object then null; end;
      begin create role authenticated; exception when duplicate_object then null; end;
    end $$;`,
      ),
    );
    await owner.query(
      'alter table public.bookings alter column booking_id set default gen_random_uuid()',
    );
    await owner.query(
      await readFile(
        new URL('../../../test/pilot-booking-rpc.sql', import.meta.url),
        'utf8',
      ),
    );
    for (const filename of [
      '20261006221452_pilot_online.sql',
      '20261006221521_pilot_notifications.sql',
      '20261006221527_pilot_lifecycle_guardrails.sql',
      '20261007002518_pilot_profile_privacy.sql',
    ])
      await owner.query(
        await readFile(
          new URL(
            '../../../../../supabase/migrations/' + filename,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    await owner.query(
      await readFile(
        new URL(
          '../../../../../supabase/migrations/20261007002528_pilot_api_cutover.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await owner.query(
      await readFile(
        new URL('../../../test/pilot-legacy-triggers.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query(
      await readFile(
        new URL('../../../../../scripts/pilot-role.sql', import.meta.url),
        'utf8',
      ),
    );
    const password = randomUUID().replaceAll('-', '');
    await admin.query(
      `create role ${loginName} login inherit nosuperuser nocreatedb nocreaterole nobypassrls password '${password}'`,
    );
    loginCreated = true;
    await admin.query(`grant krow_pilot_service to ${loginName}`);
    const privateUrl = new URL(ownerUrl);
    privateUrl.username = loginName;
    privateUrl.password = password;
    db = new PilotDatabase(
      new ConfigService({
        RIDE_PILOT_ENABLED: 'true',
        PILOT_DATABASE_URL: privateUrl.toString(),
        NODE_ENV: 'test',
      }),
    );
    service = new PilotService(db, {} as GoogleMapsService);
  }, 30000);
  afterAll(async () => {
    await db?.onModuleDestroy();
    await owner?.end();
    try {
      if (databaseCreated)
        await admin.query(`drop database ${databaseName} with (force)`);
      if (loginCreated) await admin.query(`drop role ${loginName}`);
    } finally {
      await admin?.end();
    }
  });
  async function seed() {
    const driver = actor(randomUUID()),
      passengers = [actor(randomUUID()), actor(randomUUID())];
    const rideId = randomUUID(),
      driverId = randomUUID(),
      vehicleId = randomUUID();
    const stops = [randomUUID(), randomUUID()];
    for (const user of [driver, ...passengers]) {
      await owner.query('insert into auth.users values($1)', [user.id]);
      await owner.query(
        'insert into public.users(uuid,full_name) values($1,$2)',
        [user.id, 'Cuenta sintética'],
      );
    }
    await owner.query(
      'insert into public.driver_profiles(driver_id,user_id) values($1,$2)',
      [driverId, driver.id],
    );
    await owner.query(
      "insert into public.vehicles values($1,$2,'Auto','Piloto','CI-TEST',2)",
      [vehicleId, driverId],
    );
    await owner.query(
      'insert into public.rides(ride_id,driver_id,vehicle_id,available_seats) values($1,$2,$3,1)',
      [rideId, driverId, vehicleId],
    );
    for (let index = 0; index < stops.length; index++) {
      await owner.query(
        'insert into public.transport_stops(stop_id) values($1)',
        [stops[index]],
      );
      await owner.query(
        'insert into public.ride_stops(stop_id,ride_id,transport_stop_id,stop_order,lat,lng,address) values($1,$2,$1,$3,25.67,-100.3,$4)',
        [stops[index], rideId, index + 1, 'Parada sintética ' + index],
      );
    }
    const payload = {
      ride_id: rideId,
      pickup_stop_id: stops[0],
      dropoff_stop_id: stops[1],
      seats_reserved: 1,
    };
    return { driver, passengers, rideId, payload };
  }
  it('accepts only one passenger when two confirmations compete for the last seat', async () => {
    const { driver, passengers, rideId, payload } = await seed();
    const bookings = await Promise.all(
      passengers.map((user) =>
        db.routeRpc(user.id, 'request_booking_v2', [payload]),
      ),
    );
    const results = await Promise.allSettled(
      bookings.map((id) =>
        service.updateBooking(driver, String(id), 'confirmed'),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const [{ available_seats, status }] = await db.query<{
      available_seats: number;
      status: string;
    }>('select available_seats,status from public.rides where ride_id=$1', [
      rideId,
    ]);
    expect({ available_seats, status }).toEqual({
      available_seats: 0,
      status: 'full',
    });
    const confirmed = await db.query(
      'select booking_id from public.bookings where ride_id=$1 and status=$2',
      [rideId, 'confirmed'],
    );
    expect(confirmed).toHaveLength(1);
  });
  it('serializes duplicate booking commands for the same actor without duplicate rows', async () => {
    const { passengers, rideId, payload } = await seed();
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        db.routeRpc(passengers[0].id, 'request_booking_v2', [payload]),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await db.query(
        'select booking_id from public.bookings where ride_id=$1',
        [rideId],
      ),
    ).toHaveLength(1);
    const [role] = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper,rolbypassrls from pg_roles where rolname=current_user',
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('serializes starts on different trips belonging to the same driver', async () => {
    const { driver, rideId } = await seed();
    const secondRide = randomUUID();
    await owner.query(
      'insert into public.rides(ride_id,driver_id,vehicle_id) select $2,driver_id,vehicle_id from public.rides where ride_id=$1',
      [rideId, secondRide],
    );
    const result = await Promise.allSettled(
      [rideId, secondRide].map((id) => service.lifecycle(driver, id, 'start')),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await db.query(
        "select ride_id from public.rides where ride_id=any($1::uuid[]) and status='in_progress'",
        [[rideId, secondRide]],
      ),
    ).toHaveLength(1);
  });
});
