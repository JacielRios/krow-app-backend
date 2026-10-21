import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { suggestStop } from './stop-suggestions.js';

const migration = '20261021210626_dropoff_stop_automation.sql';
const sql = (name: string) =>
  readFile(
    new URL('../../../../../supabase/migrations/' + name, import.meta.url),
    'utf8',
  );
describe('dropoff-only catalog, ordering and booking boundaries', () => {
  let db: PGlite;
  const admin = randomUUID(),
    passenger = randomUUID(),
    driverUser = randomUUID(),
    driver = randomUUID(),
    vehicle = randomUUID(),
    corridor = randomUUID(),
    campus = randomUUID();
  const stopIds = [randomUUID(), randomUUID(), randomUUID()];
  const actor = (id: string) =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const save = async (overrides: Record<string, unknown> = {}) =>
    (
      await db.query<{ id: string }>(
        'select public.admin_upsert_transport_stop($1::jsonb) id',
        [
          {
            external_id: 'krow-itnl-synthetic-descenso',
            name: 'Synthetic descent',
            latitude: 25.66,
            longitude: -100.215,
            stop_type: 'dropoff_only',
            active: true,
            corridor_id: corridor,
            corridor_order: 2,
            insert_at_order: true,
            ...overrides,
          },
        ],
      )
    ).rows[0].id;
  const orders = async () =>
    (
      await db.query<{ external_id: string; corridor_order: number }>(
        'select external_id,corridor_order from public.transport_stops where corridor_id=$1 and active order by corridor_order',
        [corridor],
      )
    ).rows;
  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
      await readFile(
        new URL('../../../test/pilot-corridors-baseline.sql', import.meta.url),
        'utf8',
      ),
    );
    const geography = await readFile(
      new URL('../../../test/campus-search-baseline.sql', import.meta.url),
      'utf8',
    );
    await db.exec(
      geography.slice(
        geography.indexOf('create schema extensions;'),
        geography.indexOf('create table public.users'),
      ),
    );
    await db.exec(`create schema krow_admin;
      create function private.is_current_admin() returns boolean language sql as $$select auth.uid()='${admin}'::uuid$$;
      create function private.is_admin_actor() returns boolean language sql as $$select auth.uid()='${admin}'::uuid$$;
      create table krow_admin.audit_log(actor_id uuid,action text,entity_type text,entity_id uuid,changes jsonb);
      alter table public.transport_stops add column location extensions.geography generated always as (array[longitude,latitude]::extensions.geography) stored;
      alter table public.ride_stops add column location extensions.geography generated always as (array[lng::double precision,lat::double precision]::extensions.geography) stored;`);
    await db.exec(
      await sql('20261007204727_pilot_corridor_selected_stops.sql'),
    );
    // Retain original uniqueness enforcement, then apply the complete new migration.
    await db.exec(
      'create unique index transport_stops_active_corridor_order_idx on public.transport_stops(corridor_id,corridor_order) where active and corridor_id is not null',
    );
    await db.exec(await sql(migration));
    await db.query(
      "insert into public.transport_corridors(corridor_id,code,name) values($1,'synthetic','Synthetic avenue')",
      [corridor],
    );
    await db.query(
      "insert into public.users(uuid,full_name) values($1,'Admin'),($2,'Passenger'),($3,'Driver')",
      [admin, passenger, driverUser],
    );
    await db.query(
      'insert into public.driver_profiles(driver_id,user_id) values($1,$2)',
      [driver, driverUser],
    );
    await db.query(
      "insert into public.vehicles values($1,$2,'Brand','Model','TEST','blue',4,true)",
      [vehicle, driver],
    );
    await db.query(
      "insert into public.transport_stops(stop_id,external_id,name,latitude,longitude,stop_type) values($1,'krow-initial-stop-2','Campus',25.664011,-100.243225,'official_boarding_zone')",
      [campus],
    );
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec(
      'delete from public.bookings;delete from public.ride_status_history;delete from public.ride_stops;delete from public.rides;delete from krow_admin.audit_log;',
    );
    await db.query('delete from public.transport_stops where corridor_id=$1', [
      corridor,
    ]);
    for (const [index, id] of stopIds.entries())
      await db.query(
        'insert into public.transport_stops(stop_id,external_id,name,latitude,longitude,corridor_id,corridor_order,stop_type) values($1,$2,$2,25.66,$3,$4,$5,$6)',
        [
          id,
          `krow-itnl-synthetic-${index}`,
          -100.23 + index * 0.01,
          corridor,
          index + 1,
          index === 1 ? 'dropoff_only' : 'general',
        ],
      );
    await actor(admin);
  });
  async function publish() {
    await actor(driverUser);
    const row = await db.query<{ id: string }>(
      'select public.create_ride_v2($1::jsonb) id',
      [
        {
          corridor_id: corridor,
          vehicle_id: vehicle,
          transport_stop_ids: [campus, ...stopIds],
          origin_lat: 25.664011,
          origin_lng: -100.243225,
          destination_lat: 25.66,
          destination_lng: -100.21,
          route_geojson: {
            type: 'LineString',
            coordinates: [
              [-100.243225, 25.664011],
              [-100.21, 25.66],
            ],
          },
          departure_time: new Date(Date.now() + 3600000).toISOString(),
          available_seats: 3,
          price_per_seat: 10,
        },
      ],
    );
    await actor(admin);
    return row.rows[0].id;
  }
  it('inserts between existing stops atomically and keeps published coordinates and order', async () => {
    const ride = await publish();
    const before = (
      await db.query(
        'select * from public.ride_stops where ride_id=$1 order by stop_order',
        [ride],
      )
    ).rows;
    const id = await save();
    expect(await orders()).toEqual([
      { external_id: 'krow-itnl-synthetic-0', corridor_order: 1 },
      { external_id: 'krow-itnl-synthetic-descenso', corridor_order: 2 },
      { external_id: 'krow-itnl-synthetic-1', corridor_order: 3 },
      { external_id: 'krow-itnl-synthetic-2', corridor_order: 4 },
    ]);
    expect(
      (
        await db.query(
          'select * from public.ride_stops where ride_id=$1 order by stop_order',
          [ride],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from krow_admin.audit_log',
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      (
        await db.query<{ stop_type: string }>(
          'select stop_type from public.transport_stops where stop_id=$1',
          [id],
        )
      ).rows[0].stop_type,
    ).toBe('dropoff_only');
  });
  it('rejects an outdated suggestion instead of silently inserting at the wrong position', async () => {
    const catalog = (
      await db.query<{
        stopId: string;
        externalId: string;
        latitude: number;
        longitude: number;
        active: boolean;
        corridorId: string;
        stopOrder: number;
        updatedAt: string;
      }>(
        'select stop_id as "stopId",external_id as "externalId",latitude,longitude,active,corridor_id as "corridorId",corridor_order as "stopOrder",updated_at as "updatedAt" from public.transport_stops where corridor_id=$1',
        [corridor],
      )
    ).rows;
    const suggestion = suggestStop(
      { latitude: 25.66, longitude: -100.215, corridorId: corridor },
      null,
      [
        {
          corridorId: corridor,
          code: 'synthetic',
          name: 'Synthetic avenue',
          direction: null,
          active: true,
        },
      ],
      catalog,
    );
    const expected = (
      await db.query<{ version: string }>(
        "select md5(string_agg(stop_id::text||':'||corridor_order::text||':'||floor(extract(epoch from updated_at)*1000)::bigint::text,'|' order by stop_id)) as version from public.transport_stops where corridor_id=$1",
        [corridor],
      )
    ).rows[0].version;
    expect(suggestion.catalogVersion).toBe(expected);
    await save({ expected_catalog_version: expected });
    const before = await orders();
    await expect(
      save({ external_id: 'another', expected_catalog_version: expected }),
    ).rejects.toThrow(/catálogo.*cambió/);
    expect(await orders()).toEqual(before);
  });
  it('rolls back shifted orders and audits when saving fails', async () => {
    const before = await orders();
    await expect(
      save({ external_id: 'krow-itnl-synthetic-0' }),
    ).rejects.toThrow(/identificador/);
    expect(await orders()).toEqual(before);
    expect(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from krow_admin.audit_log',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('requires an avenue for active descents and respects existing authorization and type checks', async () => {
    await expect(save({ corridor_id: null })).rejects.toThrow(/avenida/);
    await expect(save({ stop_type: 'invented' })).rejects.toThrow(/Tipo/);
    await expect(save({ external_id: 'krow-initial-stop-2' })).rejects.toThrow(
      /ITNL/,
    );
    await actor(passenger);
    await expect(save()).rejects.toThrow(/administrativo/);
    await actor(admin);
    await expect(save({ corridor_id: null, active: false })).resolves.toEqual(
      expect.any(String),
    );
  });
  it('rejects new pickup bookings at descents but accepts them as dropoff', async () => {
    const ride = await publish();
    const rows = (
      await db.query<{ stop_id: string; transport_stop_id: string }>(
        'select stop_id,transport_stop_id from public.ride_stops where ride_id=$1',
        [ride],
      )
    ).rows;
    const origin = rows.find(
      (row) => row.transport_stop_id === campus,
    )!.stop_id;
    const descent = rows.find(
      (row) => row.transport_stop_id === stopIds[1],
    )!.stop_id;
    const later = rows.find(
      (row) => row.transport_stop_id === stopIds[2],
    )!.stop_id;
    await expect(
      db.query(
        "insert into public.bookings(ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,'pending')",
        [ride, passenger, descent, later],
      ),
    ).rejects.toThrow(/solo de descenso/);
    await db.query(
      "insert into public.bookings(ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,'confirmed')",
      [ride, passenger, origin, descent],
    );
    await db.query(
      "update public.bookings set status='in_progress' where ride_id=$1",
      [ride],
    );
    expect(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from public.bookings',
        )
      ).rows[0].n,
    ).toBe(1);
    await actor(passenger);
    const options = await db.query<{
      pickup_stop_id: string;
      dropoff_stop_id: string;
    }>(
      'select * from public.get_ride_stop_options_pilot($1,25.664011,-100.243225,25.66,-100.22,3000)',
      [ride],
    );
    expect(options.rows.some((row) => row.dropoff_stop_id === descent)).toBe(
      true,
    );
    expect(options.rows.every((row) => row.pickup_stop_id === origin)).toBe(
      true,
    );
  });
  it('omits descents from route and campus pickup candidates, pairs and explicit pickup searches', async () => {
    await publish();
    await actor(passenger);
    const candidates = (
      await db.query<{ stop_role: string; stop_id: string; enabled: boolean }>(
        'select * from public.get_passenger_stop_candidates_v2(25.664011,-100.243225,25.66,-100.21,5000,$1)',
        ['route'],
      )
    ).rows;
    expect(
      candidates.some(
        (row) => row.stop_role === 'pickup' && row.stop_id === stopIds[1],
      ),
    ).toBe(false);
    expect(
      candidates.some(
        (row) =>
          row.stop_role === 'dropoff' &&
          row.stop_id === stopIds[1] &&
          row.enabled,
      ),
    ).toBe(true);
    const pairs = (
      await db.query<{ pickup_transport_stop_id: string }>(
        'select * from public.get_passenger_stop_pairs_v2(25.664011,-100.243225,25.66,-100.21,5000,$1)',
        ['route'],
      )
    ).rows;
    expect(
      pairs.every((row) => row.pickup_transport_stop_id !== stopIds[1]),
    ).toBe(true);
    expect(
      (
        await db.query(
          'select * from public.search_available_rides_by_stops(25.664011,-100.243225,25.66,-100.21,$1,$2,50,null,null,5000)',
          [stopIds[1], stopIds[2]],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
