import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

describe('fixed campus origin search SQL (isolated PostgreSQL)', () => {
  let db: PGlite;
  const campus = { lat: 25.664011, lng: -100.243225 };
  const pickup = { lat: 25.664, lng: -100.22 };
  const destination = { lat: 25.66, lng: -100.2 };
  const actor = randomUUID();
  const driverUser = randomUUID();
  const driverId = randomUUID();
  const vehicleId = randomUUID();
  const campusStop = randomUUID();
  const routeStop = randomUUID();
  const dropoffStop = randomUUID();
  const unusedStop = randomUUID();
  const inactiveStop = randomUUID();
  const campusRide = randomUUID();
  const otherOriginRide = randomUUID();

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
      await readFile(
        new URL('../../../../test/campus-search-baseline.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          '../../../../../../supabase/migrations/20261007145935_campus_origin_passenger_search.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
    await db.query('insert into public.users values ($1,$2)', [
      driverUser,
      'Synthetic driver',
    ]);
    await db.query('insert into public.driver_profiles values ($1,$2,4.5)', [
      driverId,
      driverUser,
    ]);
    await db.query(
      "insert into public.vehicles values ($1,'Brand','Model','TEST','blue',4)",
      [vehicleId],
    );
    for (const stop of [
      { id: campusStop, ...campus, active: true },
      { id: routeStop, ...pickup, active: true },
      { id: dropoffStop, ...destination, active: true },
      { id: unusedStop, lat: 25.6605, lng: -100.231, active: true },
      { id: inactiveStop, ...pickup, active: false },
    ]) {
      await db.query(
        "insert into public.transport_stops values ($1::uuid,$1::text,$1::text,'Synthetic address','Guadalupe','general',$2,$3,array[$3,$2]::extensions.geography,$4)",
        [stop.id, stop.lat, stop.lng, stop.active],
      );
    }
    for (const ride of [
      { id: otherOriginRide, lat: 25.7, lng: -100.25, minutes: 10 },
      { id: campusRide, ...campus, minutes: 20 },
    ]) {
      await db.query(
        "insert into public.rides values ($1,$2,$3,1,$4,$5,$6,$7,'Actual origin','Destination','polyline',5000,600,now()+$8*interval '1 minute',3,12.34,'scheduled')",
        [
          ride.id,
          driverId,
          vehicleId,
          ride.lat,
          ride.lng,
          destination.lat,
          destination.lng,
          ride.minutes,
        ],
      );
      for (const [order, stopId] of [
        campusStop,
        routeStop,
        dropoffStop,
      ].entries()) {
        await db.query(
          'insert into public.ride_stops select $1,$2,stop_id,$3,latitude,longitude,address,location,true,1 from public.transport_stops where stop_id=$4',
          [randomUUID(), ride.id, order, stopId],
        );
      }
    }
  }, 30000);
  afterAll(async () => {
    await db.close();
  });

  const candidateArgs = (scope: 'campus' | 'route') => [
    campus.lat,
    campus.lng,
    destination.lat,
    destination.lng,
    250,
    scope,
  ];

  it('filters the actual ride origin before the result limit without losing intermediate pickup', async () => {
    const result = await db.query<{ ride_id: string; pickup_stop_lat: string }>(
      'select * from public.search_available_rides_v2($1,$2,$3,$4,1,null,null,250)',
      [pickup.lat, pickup.lng, destination.lat, destination.lng],
    );
    expect(result.rows.map((row) => row.ride_id)).toEqual([campusRide]);
    expect(Number(result.rows[0].pickup_stop_lat)).toBe(pickup.lat);
  });

  it('applies the same campus filter to explicit stop searches before LIMIT', async () => {
    const result = await db.query<{ ride_id: string }>(
      'select * from public.search_available_rides_by_stops($1,$2,$3,$4,$5,$6,1,null,null,250)',
      [
        pickup.lat,
        pickup.lng,
        destination.lat,
        destination.lng,
        routeStop,
        dropoffStop,
      ],
    );
    expect(result.rows.map((row) => row.ride_id)).toEqual([campusRide]);
  });

  it('keeps campus as the default boarding area for older RPC clients', async () => {
    const result = await db.query<{
      stop_id: string;
      stop_role: string;
      ride_count: number;
    }>(
      'select * from public.get_passenger_stop_candidates($1,$2,$3,$4,250)',
      candidateArgs('campus').slice(0, 4),
    );
    const pickups = result.rows.filter((row) => row.stop_role === 'pickup');
    expect(pickups.map((row) => row.stop_id)).toEqual([campusStop]);
    expect(Number(pickups[0].ride_count)).toBe(1);
  });

  it('shows route catalog pickups with accurate availability and no inactive stops', async () => {
    const result = await db.query<{
      stop_id: string;
      stop_role: string;
      enabled: boolean;
      ride_count: number;
    }>(
      'select * from public.get_passenger_stop_candidates_v2($1,$2,$3,$4,$5,$6)',
      candidateArgs('route'),
    );
    const pickups = result.rows.filter((row) => row.stop_role === 'pickup');
    expect(pickups.map((row) => row.stop_id).sort()).toEqual(
      [campusStop, routeStop, dropoffStop, unusedStop].sort(),
    );
    expect(pickups.find((row) => row.stop_id === routeStop)?.enabled).toBe(
      true,
    );
    expect(
      Number(pickups.find((row) => row.stop_id === routeStop)?.ride_count),
    ).toBe(1);
    expect(pickups.find((row) => row.stop_id === unusedStop)?.enabled).toBe(
      false,
    );
    expect(pickups.find((row) => row.stop_id === dropoffStop)?.enabled).toBe(
      false,
    );
    expect(
      result.rows.find((row) => row.stop_role === 'dropoff')?.enabled,
    ).toBe(true);
  });

  it('returns ordered intermediate pickup pairs only for campus-origin rides', async () => {
    const route = await db.query<{
      pickup_transport_stop_id: string;
      dropoff_transport_stop_id: string;
      ride_count: number;
    }>(
      'select * from public.get_passenger_stop_pairs_v2($1,$2,$3,$4,$5,$6)',
      candidateArgs('route'),
    );
    expect(
      route.rows
        .map((row) => [
          row.pickup_transport_stop_id,
          row.dropoff_transport_stop_id,
        ])
        .sort(),
    ).toEqual(
      [
        [campusStop, dropoffStop],
        [routeStop, dropoffStop],
      ].sort(),
    );
    expect(route.rows.every((row) => Number(row.ride_count) === 1)).toBe(true);
    const defaultPairs = await db.query<{ pickup_transport_stop_id: string }>(
      'select * from public.get_passenger_stop_pairs($1,$2,$3,$4,250)',
      candidateArgs('campus').slice(0, 4),
    );
    expect(
      defaultPairs.rows.map((row) => row.pickup_transport_stop_id),
    ).toEqual([campusStop]);
  });

  it('does not expose a passenger own driver trips', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      driverUser,
    ]);
    try {
      const result = await db.query(
        'select * from public.get_passenger_stop_pairs_v2($1,$2,$3,$4,$5,$6)',
        candidateArgs('route'),
      );
      expect(result.rows).toEqual([]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        actor,
      ]);
    }
  });

  it('rejects missing identity and invalid scope, and keeps anonymous EXECUTE revoked', async () => {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await expect(
      db.query(
        'select * from public.get_passenger_stop_pairs_v2($1,$2,$3,$4,$5,$6)',
        candidateArgs('route'),
      ),
    ).rejects.toThrow('No autenticado');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
    await expect(
      db.query(
        'select * from public.get_passenger_stop_pairs_v2($1,$2,$3,$4,$5,$6)',
        [...candidateArgs('route').slice(0, 5), 'invalid'],
      ),
    ).rejects.toThrow('Alcance de subida no valido');
    const privileges = await db.query<{
      anonymous: boolean;
      signed_in: boolean;
    }>(
      "select has_function_privilege('anon','public.get_passenger_stop_pairs_v2(double precision,double precision,double precision,double precision,integer,text)','execute') anonymous,has_function_privilege('authenticated','public.get_passenger_stop_pairs_v2(double precision,double precision,double precision,double precision,integer,text)','execute') signed_in",
    );
    expect(privileges.rows[0]).toEqual({ anonymous: false, signed_in: true });
  });
});
