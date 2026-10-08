import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

describe('pilot corridors and destination matching (isolated PostgreSQL)', () => {
  let db: PGlite;
  const actor = randomUUID(),
    driverUser = randomUUID(),
    driver = randomUUID(),
    vehicle = randomUUID();
  const campus = randomUUID(),
    stops = [randomUUID(), randomUUID(), randomUUID()],
    other = randomUUID();
  let corridor: string;
  const destination = { lat: 25.66, lng: -100.21 };
  const payload = (stopIds: string[]) => ({
    corridor_id: corridor,
    vehicle_id: vehicle,
    transport_stop_ids: [campus, ...stopIds],
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
    route_provider: 'google',
    route_distance_meters: 7000,
    route_duration_seconds: 800,
    departure_time: new Date(Date.now() + 60 * 60000).toISOString(),
    available_seats: 3,
    price_per_seat: 12.34,
  });
  const asActor = (id: string) =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const publish = async (ids: string[], minutes = 60) => {
    await asActor(driverUser);
    const result = await db.query<{ id: string }>(
      'select public.create_ride_v2($1::jsonb) id',
      [
        {
          ...payload(ids),
          departure_time: new Date(Date.now() + minutes * 60000).toISOString(),
        },
      ],
    );
    await asActor(actor);
    return result.rows[0].id;
  };
  const search = (radius = 3000, limit = 50) =>
    db.query<{ ride_id: string; dropoff_distance_m: number }>(
      'select * from public.search_available_rides_pilot(25.664011,-100.243225,$1,$2,$3,null,null,$4)',
      [destination.lat, destination.lng, limit, radius],
    );

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
      await readFile(
        new URL(
          '../../../../test/pilot-corridors-baseline.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const legacy = await readFile(
      new URL(
        '../../../../../../supabase/migrations/20260918195358_driver_routes_and_stops.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const requestStart = legacy.indexOf(
      'create or replace function public.request_booking_v2(',
    );
    await db.exec(
      legacy.slice(requestStart, legacy.indexOf('\n$$;', requestStart) + 4),
    );
    await db.query(
      "insert into public.users(uuid,full_name) values($1,'Synthetic passenger'),($2,'Synthetic driver')",
      [actor, driverUser],
    );
    await db.query(
      'insert into public.driver_profiles(driver_id,user_id,rating) values($1,$2,4.5)',
      [driver, driverUser],
    );
    await db.query(
      "insert into public.vehicles values($1,$2,'Brand','Model','SYNTH','blue',4,true)",
      [vehicle, driver],
    );
    await db.query(
      "insert into public.transport_stops(stop_id,external_id,name,latitude,longitude,stop_type) values($1,'krow-initial-stop-2','ITNL',25.664011,-100.243225,'official_boarding_zone'),($2,'krow-itnl-eloy-synthetic','Other avenue',25.66,-100.20,'general')",
      [campus, other],
    );
    for (const [index, id] of stops.entries())
      await db.query(
        'insert into public.transport_stops(stop_id,external_id,name,latitude,longitude) values($1,$2,$3,$4,$5)',
        [
          id,
          `krow-itnl-pablo-synthetic-${index}`,
          `Synthetic ${index}`,
          destination.lat + [300, 800, 1500][index] / 111195,
          destination.lng,
        ],
      );
    await db.exec(
      await readFile(
        new URL(
          '../../../../../../supabase/migrations/20261007204727_pilot_corridor_selected_stops.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    corridor = (
      await db.query<{ corridor_id: string }>(
        "select corridor_id from public.transport_corridors where code='pablo-livas'",
      )
    ).rows[0].corridor_id;
    await asActor(actor);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec(
      'delete from public.bookings;delete from public.ride_status_history;delete from public.ride_stops;delete from public.rides;delete from public.favorite_route_stops;delete from public.favorite_routes;update public.transport_stops set active=true;update public.transport_corridors set active=true;',
    );
    await asActor(actor);
  });

  it('publishes only explicitly selected descents plus automatic campus', async () => {
    const id = await publish([stops[1]]);
    const selected = await db.query<{ transport_stop_id: string }>(
      'select transport_stop_id from public.ride_stops where ride_id=$1 order by stop_order',
      [id],
    );
    expect(selected.rows.map((row) => row.transport_stop_id)).toEqual([
      campus,
      stops[1],
    ]);
    expect(
      (
        await db.query<{ corridor_id: string }>(
          'select corridor_id from public.rides where ride_id=$1',
          [id],
        )
      ).rows[0].corridor_id,
    ).toBe(corridor);
  });
  it('rejects missing selection, other avenues, inactive stops and duplicate IDs', async () => {
    await asActor(driverUser);
    for (const ids of [[], [other], [stops[0], stops[0]]])
      await expect(
        db.query('select public.create_ride_v2($1::jsonb)', [payload(ids)]),
      ).rejects.toThrow(/parada|avenida/);
    await db.query(
      'update public.transport_stops set active=false where stop_id=$1',
      [stops[0]],
    );
    await expect(
      db.query('select public.create_ride_v2($1::jsonb)', [
        payload([stops[0]]),
      ]),
    ).rejects.toThrow('avenida activa');
  });
  it('ranks 300, 800 and 1500 meter descents before departure, including before LIMIT', async () => {
    const distant = await publish([stops[2]], 30),
      middle = await publish([stops[1]], 40),
      close = await publish([stops[0]], 50);
    expect((await search()).rows.map((row) => row.ride_id)).toEqual([
      close,
      middle,
      distant,
    ]);
    expect((await search(3000, 1)).rows[0].ride_id).toBe(close);
    expect((await search(1000)).rows.map((row) => row.ride_id)).toEqual([
      close,
      middle,
    ]);
  });
  it('shows every available descent in detail even outside the matching radius', async () => {
    const far = randomUUID();
    await db.query(
      "insert into public.transport_stops(stop_id,external_id,name,latitude,longitude,corridor_id,corridor_order) values($1,'synthetic-far','Far selected stop',25.66,-100.15,$2,20)",
      [far, corridor],
    );
    const id = await publish([stops[0], far]);
    const options = await db.query<{
      dropoff_distance_m: number;
      dropoff_stop_id: string;
    }>('select * from public.get_ride_stop_options_pilot($1,0,0,$2,$3,1000)', [
      id,
      destination.lat,
      destination.lng,
    ]);
    expect(options.rows).toHaveLength(2);
    expect(Number(options.rows[1].dropoff_distance_m)).toBeGreaterThan(5000);
    expect((await search()).rows.map((row) => row.ride_id)).toContain(id);
    const pair = await db.query<{
      pickup_stop_id: string;
      dropoff_stop_id: string;
    }>('select * from public.get_ride_stop_options_pilot($1,0,0,$2,$3,1000)', [
      id,
      destination.lat,
      destination.lng,
    ]);
    const booking = await db.query<{ id: string }>(
      'select public.request_booking_v2($1::jsonb) id',
      [
        {
          ride_id: id,
          pickup_stop_id: pair.rows[1].pickup_stop_id,
          dropoff_stop_id: pair.rows[1].dropoff_stop_id,
          seats_reserved: 1,
        },
      ],
    );
    expect(booking.rows[0].id).toEqual(expect.any(String));
  });
  it('removes inactive/versioned-out stops without moving committed bookings', async () => {
    const id = await publish([stops[0], stops[1]]);
    const real = await db.query<{ stop_id: string; transport_stop_id: string }>(
      'select stop_id,transport_stop_id from public.ride_stops where ride_id=$1 order by stop_order',
      [id],
    );
    await db.query(
      "insert into public.bookings(ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,'confirmed')",
      [id, actor, real.rows[0].stop_id, real.rows[1].stop_id],
    );
    await db.query(
      'update public.transport_stops set active=false where stop_id=$1',
      [stops[0]],
    );
    const options = await db.query<{ dropoff_stop_id: string }>(
      'select * from public.get_ride_stop_options_pilot($1,0,0,$2,$3)',
      [id, destination.lat, destination.lng],
    );
    expect(options.rows.map((row) => row.dropoff_stop_id)).toEqual([
      real.rows[2].stop_id,
    ]);
    expect(
      (
        await db.query<{ dropoff_stop_id: string }>(
          'select dropoff_stop_id from public.bookings',
        )
      ).rows[0].dropoff_stop_id,
    ).toBe(real.rows[1].stop_id);
  });
  it('keeps a legacy trip without corridor discoverable and its stops unchanged', async () => {
    const id = await publish([stops[0]]);
    await db.query(
      'update public.rides set corridor_id=null where ride_id=$1',
      [id],
    );
    expect((await search()).rows.map((row) => row.ride_id)).toContain(id);
  });
  it('favorites persist selected stops and remain valid with optional defaults absent', async () => {
    await asActor(driverUser);
    const fav = await db.query<{ id: string }>(
      'select public.upsert_favorite_route($1::jsonb) id',
      [{ ...payload([stops[1]]), name: 'Synthetic favorite' }],
    );
    const selected = await db.query<{ transport_stop_id: string }>(
      'select transport_stop_id from public.favorite_route_stops where route_id=$1 order by stop_order',
      [fav.rows[0].id],
    );
    expect(selected.rows.map((row) => row.transport_stop_id)).toEqual([
      campus,
      stops[1],
    ]);
  });
  it('keeps anonymous read and authenticated publishing forbidden with safe public wrappers', async () => {
    const rights = await db.query<{
      anon_read: boolean;
      client_write: boolean;
      api_write: boolean;
      definer: boolean;
    }>(
      "select has_function_privilege('anon','public.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer)','execute') anon_read,has_function_privilege('authenticated','public.create_ride_v2(jsonb)','execute') client_write,has_function_privilege('krow_pilot_service','public.create_ride_v2(jsonb)','execute') api_write,(select prosecdef from pg_proc where oid='public.search_available_rides_pilot(double precision,double precision,double precision,double precision,integer,timestamptz,timestamptz,integer)'::regprocedure) definer",
    );
    expect(rights.rows[0]).toEqual({
      anon_read: false,
      client_write: false,
      api_write: true,
      definer: false,
    });
    await asActor('');
    await expect(search()).rejects.toThrow('No autenticado');
  });
  it('validates null/invalid direct RPC arguments before unbounded queries or map data', async () => {
    await expect(
      db.query(
        'select * from public.search_available_rides_pilot(0,0,25,-100,null,null,null,3000)',
      ),
    ).rejects.toThrow('Limite');
    await expect(
      db.query(
        'select * from public.search_available_rides_pilot(0,0,25,-100,50,null,null,null)',
      ),
    ).rejects.toThrow('Distancia');
    await expect(
      db.query(
        'select * from public.search_available_rides_pilot(0,0,null,-100)',
      ),
    ).rejects.toThrow('Destino');
    await expect(
      db.query(
        'select * from public.get_ride_stop_options_pilot($1,0,0,null,-100)',
        [randomUUID()],
      ),
    ).rejects.toThrow('Destino');
  });
});
