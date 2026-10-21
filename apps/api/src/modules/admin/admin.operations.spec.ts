import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PilotDatabase } from '../pilot/pilot.database.js';
import { PilotService } from '../pilot/pilot.service.js';
import { PilotOperations } from '../pilot/pilot.operations.js';
import { AdminOperations } from './admin.operations.js';
import type { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { ForbiddenException } from '@nestjs/common';
class Embedded extends PilotDatabase {
  constructor(readonly pg: PGlite) {
    super(new ConfigService({ RIDE_PILOT_ENABLED: 'true' }));
  }
  override async query<T extends QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.pg.query<T>(sql, values)).rows;
  }
  override async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    return this.pg.transaction((tx) =>
      work({
        query: async (sql: string, values: unknown[] = []) => {
          const r = await tx.query(sql, values);
          return { rows: r.rows, rowCount: r.affectedRows };
        },
      } as PoolClient),
    );
  }
}
describe('pilot incident lifecycle, private access and eligibility', () => {
  let pg: PGlite,
    db: Embedded,
    operations: AdminOperations,
    pilot: PilotOperations;
  const adminId = randomUUID(),
    passengerId = randomUUID(),
    driverUser = randomUUID(),
    driverId = randomUUID(),
    vehicleId = randomUUID(),
    rideId = randomUUID();
  const actor = (id: string, admin = false): AuthenticatedUser => ({
    id,
    email: null,
    accessToken: 'synthetic',
    userMetadata: {},
    appMetadata: admin ? { role: 'admin' } : {},
  });
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    db = new Embedded(pg);
    await pg.exec(
      await readFile(
        new URL('../../../test/admin-baseline.sql', import.meta.url),
        'utf8',
      ),
    );
    await pg.exec(
      'alter table public.users add column profile_photo text,add column rating numeric',
    );
    await pg.exec(
      await readFile(
        new URL(
          '../../../../../supabase/migrations/20261007170120_admin_management.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await pg.exec(
      'alter table krow_admin.audit_log drop constraint audit_log_entity_type_check; create table krow_pilot.tracking_sessions(ride_id uuid,position jsonb,expires_at timestamptz);',
    );
    await pg.exec(
      await readFile(
        new URL(
          '../../../../../supabase/migrations/20261016175233_pilot_operations.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    for (const id of [adminId, passengerId, driverUser]) {
      await pg.query(
        'insert into auth.users(id,raw_app_meta_data) values($1,$2)',
        [id, id === adminId ? { role: 'admin' } : {}],
      );
      await pg.query(
        'insert into public.users(uuid,full_name,email_address) values($1,$2,$3)',
        [id, 'Prueba', `${id}@example.invalid`],
      );
    }
    await pg.query(
      "insert into public.driver_profiles(driver_id,user_id,license_number,license_expiry,status,admin_status) values($1,$2,'SYNTH','2099-01-01','approved','active')",
      [driverId, driverUser],
    );
    await pg.query(
      "insert into public.vehicles(vehicle_id,driver_id,license_plate,brand,model,car_year,car_color,capacity,is_active,admin_status) values($1,$2,'SYNTH','Marca','Modelo',2025,'Azul',4,true,'active')",
      [vehicleId, driverId],
    );
    await pg.query(
      "insert into public.rides(ride_id,driver_id,vehicle_id,status,origin_lat,origin_lng,destination_lat,destination_lng) values($1,$2,$3,'scheduled',25.6,-100.3,25.7,-100.2)",
      [rideId, driverId, vehicleId],
    );
    const a = randomUUID(),
      b = randomUUID(),
      booking = randomUUID();
    await pg.query(
      "insert into public.ride_stops(stop_id,ride_id,lat,lng,address,stop_order) values($1,$3,25.6,-100.3,'A',1),($2,$3,25.7,-100.2,'B',2)",
      [a, b, rideId],
    );
    await pg.query(
      "insert into public.bookings(booking_id,ride_id,user_id,pickup_stop_id,dropoff_stop_id,status) values($1,$2,$3,$4,$5,'confirmed')",
      [booking, rideId, passengerId, a, b],
    );
    await pg.query('insert into krow_pilot.booking_prices values($1,1000)', [
      booking,
    ]);
    const maps = {} as GoogleMapsService;
    pilot = new PilotOperations(db, new PilotService(db, maps), maps);
    operations = new AdminOperations(db);
  }, 30000);
  afterAll(async () => {
    await pg?.close();
  });
  it('accepts a participant report once, then audits acknowledgment and resolution', async () => {
    const reporter = actor(passengerId),
      admin = actor(adminId, true),
      clientId = randomUUID();
    const report = await pilot.report(
      reporter,
      rideId,
      clientId,
      'vehicle',
      'Revisar el cinturón',
    );
    expect(
      await pilot.report(
        reporter,
        rideId,
        clientId,
        'vehicle',
        'Revisar el cinturón',
      ),
    ).toEqual(report);
    await expect(
      pilot.report(
        actor(randomUUID()),
        rideId,
        randomUUID(),
        'other',
        'Sin participación',
      ),
    ).rejects.toThrow();
    await expect(operations.incidents(reporter)).rejects.toThrow(
      ForbiddenException,
    );
    expect(await operations.incidents(admin, 'open')).toHaveLength(1);
    await operations.update(admin, report.incidentId, 'acknowledged', '');
    await expect(
      operations.update(admin, report.incidentId, 'resolved', ''),
    ).rejects.toThrow();
    await operations.update(
      admin,
      report.incidentId,
      'resolved',
      'Se reemplazó el cinturón',
    );
    expect(await operations.incidents(admin, 'open')).toHaveLength(0);
    expect(
      (
        await pg.query(
          'select count(*)::int n from krow_admin.audit_log where entity_id=$1',
          [report.incidentId],
        )
      ).rows[0],
    ).toEqual({ n: 2 });
  });
  it('denies direct client access to reports and location route overrides', async () => {
    for (const table of ['incidents', 'operational_routes'])
      expect(
        (
          await pg.query(
            "select has_table_privilege('authenticated',$1,'SELECT') allowed",
            [`krow_pilot.${table}`],
          )
        ).rows[0],
      ).toEqual({ allowed: false });
  });
  it('rechecks license expiry on start while preserving cancellation', async () => {
    await pg.query(
      "update public.driver_profiles set license_expiry='2000-01-01' where driver_id=$1",
      [driverId],
    );
    await expect(
      pg.query(
        "update public.rides set status='in_progress' where ride_id=$1",
        [rideId],
      ),
    ).rejects.toThrow(/licencia vigente/);
    await pg.query(
      "update public.rides set status='cancelled' where ride_id=$1",
      [rideId],
    );
    await pg.query(
      "update public.driver_profiles set license_expiry='2099-01-01' where driver_id=$1",
      [driverId],
    );
  });
  it('requires all approved documents when the public-release policy is enabled', async () => {
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec(
          "select set_config('krow.require_documents','true',true)",
        );
        await tx.query(
          "update public.rides set status='in_progress' where ride_id=$1",
          [rideId],
        );
      }),
    ).rejects.toThrow(/seguro/);
  });
});
