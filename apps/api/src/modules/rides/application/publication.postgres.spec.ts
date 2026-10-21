import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PilotDatabase } from '../../pilot/pilot.database.js';

const testUrl = process.env.TEST_PILOT_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

// Real locking and permissions; synthetic catalog geometry, never live data.
integration('publication receipts on real PostgreSQL', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `krow_publication_test_${suffix}`;
  const loginName = `krow_publication_login_${suffix}`;
  const actor = randomUUID(),
    driver = randomUUID(),
    vehicle = randomUUID();
  const campus = randomUUID(),
    stop = randomUUID();
  let admin: pg.Pool, owner: pg.Pool, db: PilotDatabase;
  let databaseCreated = false,
    loginCreated = false;
  let payload: Record<string, unknown>;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testUrl });
    await admin.query(`create database ${databaseName}`);
    databaseCreated = true;
    const ownerUrl = new URL(testUrl!);
    ownerUrl.pathname = '/' + databaseName;
    owner = new pg.Pool({ connectionString: ownerUrl.toString() });
    const fixture = await readFile(
      new URL('../../../../test/pilot-corridors-baseline.sql', import.meta.url),
      'utf8',
    );
    await owner.query(
      fixture.replace(
        /create role (anon|authenticated|krow_pilot_service);/g,
        (_match, role: string) =>
          `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} nologin nosuperuser nobypassrls; end if; end $$;`,
      ),
    );
    await owner.query(
      'insert into public.users(uuid,full_name) values($1,$2)',
      [actor, 'Synthetic driver'],
    );
    await owner.query(
      'insert into public.driver_profiles(driver_id,user_id) values($1,$2)',
      [driver, actor],
    );
    await owner.query(
      "insert into public.vehicles values($1,$2,'Brand','Model','SYNTH','blue',4,true)",
      [vehicle, driver],
    );
    await owner.query(
      "insert into public.transport_stops(stop_id,external_id,name,latitude,longitude,stop_type) values($1,'krow-initial-stop-2','ITNL',25.664011,-100.243225,'official_boarding_zone'),($2,'krow-itnl-pablo-synthetic','Stop',25.66,-100.21,'general')",
      [campus, stop],
    );
    for (const file of [
      '20261007204727_pilot_corridor_selected_stops.sql',
      '20261020191646_booking_departure_deadline.sql',
      '20261020191658_ride_publication_idempotency.sql',
    ])
      await owner.query(
        await readFile(
          new URL(
            '../../../../../../supabase/migrations/' + file,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    const corridor = (
      await owner.query<{ corridor_id: string }>(
        "select corridor_id from public.transport_corridors where code='pablo-livas'",
      )
    ).rows[0].corridor_id;
    payload = {
      corridor_id: corridor,
      vehicle_id: vehicle,
      transport_stop_ids: [campus, stop],
      origin_lat: 25.664011,
      origin_lng: -100.243225,
      origin_address: 'ITNL',
      destination_lat: 25.66,
      destination_lng: -100.19,
      destination_address: 'Synthetic destination',
      route_polyline: 'synthetic',
      route_geojson: {
        type: 'LineString',
        coordinates: [
          [-100.243225, 25.664011],
          [-100.19, 25.66],
        ],
      },
      route_distance_meters: 7000,
      route_duration_seconds: 800,
      departure_time: new Date(Date.now() + 3600000).toISOString(),
      available_seats: 3,
      price_per_seat: 12.34,
    };
    await owner.query(
      'grant select on public.users to krow_pilot_service; grant update(is_active) on public.users to krow_pilot_service',
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

  it('returns one trip to simultaneous retries through the limited API login', async () => {
    const request = { trip: randomUUID() };
    const requestId = randomUUID();
    const data = {
      ...payload,
      publication_request_id: requestId,
      publication_request: request,
    };
    const results = await Promise.all(
      [0, 1, 2, 3].map(() => db.routeRpc(actor, 'create_ride_v2', [data])),
    );
    expect(new Set(results).size).toBe(1);
    expect((await owner.query('select * from public.rides')).rows).toHaveLength(
      1,
    );
    expect(
      (await owner.query('select * from private.ride_publication_requests'))
        .rows,
    ).toHaveLength(1);
    await expect(
      db.routeRpc(actor, 'get_ride_publication', [requestId, request]),
    ).resolves.toBe(results[0]);
    await expect(
      db.routeRpc(actor, 'get_ride_publication', [
        requestId,
        { trip: 'other' },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      db.query('select * from private.ride_publication_requests'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('also serializes callers at the SQL boundary, without the NestJS transaction wrapper', async () => {
    const requestId = randomUUID();
    const data = {
      ...payload,
      publication_request_id: requestId,
      publication_request: { trip: requestId },
    };
    const publish = async () => {
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query(
          "select set_config('request.jwt.claim.sub',$1,true)",
          [actor],
        );
        const result = await client.query<{ id: string }>(
          'select public.create_ride_v2($1) id',
          [data],
        );
        await client.query('commit');
        return result.rows[0].id;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    };
    const results = await Promise.all([publish(), publish(), publish()]);
    expect(new Set(results).size).toBe(1);
    expect(
      (
        await owner.query(
          'select * from private.ride_publication_requests where request_id=$1',
          [requestId],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
