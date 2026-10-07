import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import type { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import { PilotDatabase } from '../pilot/pilot.database.js';
import { AdminService } from './admin.service.js';
import { adminTransaction } from './admin.database.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminDriverListDto,
  CreateAdminDocumentDto,
  CreateAdminDriverDto,
} from './admin.dto.js';

class AdminEmbeddedDatabase extends PilotDatabase {
  constructor(readonly postgres: PGlite) {
    super(new ConfigService({ RIDE_PILOT_ENABLED: 'true' }));
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
    return this.postgres.transaction(async (tx) => {
      await tx.exec('set local role krow_pilot_service');
      return work({
        query: async (sql: string, values: unknown[] = []) => {
          const r = await tx.query(sql, values);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        },
      } as unknown as PoolClient);
    });
  }
}
describe('administration SQL integration and permissions', () => {
  let pg: PGlite, db: AdminEmbeddedDatabase, service: AdminService;
  let admin: AuthenticatedUser,
    passenger: AuthenticatedUser,
    userId: string,
    driverId: string,
    vehicleId: string;
  let fileSize = 123;
  const fileType = 'application/pdf';
  const actor = (id: string, role?: string): AuthenticatedUser => ({
    id,
    email: 'operator@synthetic.invalid',
    accessToken: 'synthetic-jwt',
    appMetadata: role ? { role } : {},
    userMetadata: {},
  });
  const storage = {
    createSignedUploadUrl: jest.fn((path: string) =>
      Promise.resolve({
        data: {
          path,
          token: 'synthetic-upload-token',
          signedUrl: 'https://synthetic.invalid/upload',
        },
        error: null,
      }),
    ),
    info: jest.fn(() =>
      Promise.resolve({
        data: { size: fileSize, contentType: fileType },
        error: null,
      }),
    ),
    createSignedUrl: jest.fn(() =>
      Promise.resolve({
        data: { signedUrl: 'https://synthetic.invalid/private-download' },
        error: null,
      }),
    ),
  };
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    db = new AdminEmbeddedDatabase(pg);
    await pg.exec(
      await readFile(
        new URL('../../../test/admin-baseline.sql', import.meta.url),
        'utf8',
      ),
    );
    const adminId = randomUUID();
    userId = randomUUID();
    admin = actor(adminId, 'admin');
    passenger = actor(userId);
    await pg.query(
      'insert into auth.users(id,raw_app_meta_data) values($1,$2),($3,$4)',
      [adminId, { role: 'admin' }, userId, {}],
    );
    await pg.query(
      'insert into public.users(uuid,full_name,email_address) values($1,$2,$3),($4,$5,$6)',
      [
        adminId,
        'Operador sintético',
        'operator@synthetic.invalid',
        userId,
        'Persona sintética',
        'person@synthetic.invalid',
      ],
    );
    driverId = randomUUID();
    vehicleId = randomUUID();
    await pg.query(
      "insert into public.driver_profiles(driver_id,user_id,license_number,license_expiry,status) values($1,$2,'SYNTHETIC','2099-12-31','approved')",
      [driverId, userId],
    );
    await pg.query(
      "insert into public.vehicles(vehicle_id,driver_id,license_plate,brand,model,car_year,car_color,capacity) values($1,$2,'SYNTH-1','Marca','Modelo',2025,'Azul',4)",
      [vehicleId, driverId],
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
      await readFile(
        new URL(
          '../../../../../supabase/migrations/20261007171623_admin_route_catalog_read.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    service = new AdminService(db, {
      forUser: () => ({ storage: { from: () => storage } }),
    } as unknown as SupabaseService);
  }, 30000);
  afterAll(async () => {
    await pg.close();
  });
  it('backfills existing approved drivers and active vehicles without closing accounts', async () => {
    const drivers = await service.drivers(admin, new AdminDriverListDto());
    expect(drivers.items[0]).toMatchObject({
      driverId,
      status: 'active',
      approvalStatus: 'approved',
      compliance: { state: 'attention' },
    });
    const vehicles = await service.vehicles(admin, { page: 1, pageSize: 20 });
    expect(vehicles.items[0]).toMatchObject({
      vehicleId,
      isActive: true,
      status: 'active',
    });
    expect(
      (
        await pg.query<{ is_active: boolean }>(
          'select is_active from public.users where uuid=$1',
          [userId],
        )
      ).rows[0].is_active,
    ).toBe(true);
  });
  it('uses Monterrey local calendar dates for document and license expiry decisions', async () => {
    const row = await adminTransaction(
      db,
      admin,
      async (client) =>
        (
          await client.query<{ zone: string; local_dates_match: boolean }>(
            "select current_setting('TimeZone') as zone,current_date=(current_timestamp at time zone 'America/Monterrey')::date as local_dates_match",
          )
        ).rows[0],
    );
    expect(row).toEqual({ zone: 'America/Monterrey', local_dates_match: true });
  });
  it('allows only catalog identifiers and names through verified admin RLS', async () => {
    const id = randomUUID();
    await pg.query(
      "insert into public.transport_stops(stop_id,name) values($1,'Parada de prueba')",
      [id],
    );
    const permitted = await adminTransaction(
      db,
      admin,
      async (client) =>
        (
          await client.query<{ name: string }>(
            'select name from public.transport_stops where stop_id=$1',
            [id],
          )
        ).rows,
    );
    expect(permitted).toEqual([{ name: 'Parada de prueba' }]);
    const hidden = await db.transaction(async (client) => {
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        passenger.id,
      ]);
      return (
        await client.query<{ stop_id: string; name: string }>(
          'select stop_id,name from public.transport_stops',
        )
      ).rows;
    });
    expect(hidden).toEqual([]);
    const grants = (
      await pg.query<{
        broad_select: boolean;
        name_select: boolean;
        stop_id_select: boolean;
      }>(
        "select has_table_privilege('krow_pilot_service','public.transport_stops','select') as broad_select,has_column_privilege('krow_pilot_service','public.transport_stops','name','select') as name_select,has_column_privilege('krow_pilot_service','public.transport_stops','stop_id','select') as stop_id_select",
      )
    ).rows[0];
    expect(grants).toEqual({
      broad_select: false,
      name_select: true,
      stop_id_select: true,
    });
  });
  it('rejects passenger requests and user_metadata admin spoofing', async () => {
    await expect(service.me(passenger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.me({ ...passenger, userMetadata: { role: 'admin' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects stale admin metadata after authoritative demotion', async () => {
    const stale = { ...passenger, appMetadata: { role: 'admin' } };
    await expect(service.me(stale)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires an existing public profile for authoritative admin eligibility', async () => {
    const id = randomUUID();
    await pg.query(
      'insert into auth.users(id,raw_app_meta_data) values($1,\'{"role":"admin"}\')',
      [id],
    );
    await expect(service.me(actor(id, 'admin'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('blocks administrator accounts disabled in public profiles', async () => {
    await pg.query('update public.users set is_active=false where uuid=$1', [
      admin.id,
    ]);
    await expect(service.me(admin)).rejects.toBeInstanceOf(ForbiddenException);
    await pg.query('update public.users set is_active=true where uuid=$1', [
      admin.id,
    ]);
  });
  it('creates a driver for an existing account and returns duplicate conflict without a second audit', async () => {
    const id = randomUUID();
    await pg.query('insert into auth.users(id) values($1)', [id]);
    await pg.query(
      'insert into public.users(uuid,email_address,full_name) values($1,$2,$3)',
      [id, 'another@synthetic.invalid', 'Otra persona'],
    );
    const dto = {
      email: 'another@synthetic.invalid',
      licenseNumber: 'L-NEW',
      licenseExpiresAt: '2099-01-01',
      status: 'active' as const,
    };
    const result = await service.createDriver(admin, dto);
    expect(result).toMatchObject({
      userId: id,
      status: 'active',
      approvalStatus: 'approved',
    });
    await expect(service.createDriver(admin, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      (
        await service.audit(admin, {
          page: 1,
          pageSize: 20,
          entityId: String(result.driverId),
        })
      ).total,
    ).toBe(1);
  });
  it('suspends only driver capability, preserves trips and passenger eligibility, then restores approval', async () => {
    const result = await service.driverStatus(admin, driverId, {
      status: 'suspended',
      reason: 'Revisión sintética',
    });
    expect(result).toMatchObject({
      status: 'suspended',
      approvalStatus: 'suspended',
    });
    const account = (
      await pg.query<{ is_active: boolean }>(
        'select is_active from public.users where uuid=$1',
        [userId],
      )
    ).rows[0];
    expect(account.is_active).toBe(true);
    await service.driverStatus(admin, driverId, { status: 'active' });
    expect((await service.driver(admin, driverId)).approvalStatus).toBe(
      'approved',
    );
  });
  it('records inactive operational state as pending approval rather than an invented rejection', async () => {
    expect(
      await service.driverStatus(admin, driverId, { status: 'inactive' }),
    ).toMatchObject({ status: 'inactive', approvalStatus: 'pending' });
    await service.driverStatus(admin, driverId, { status: 'active' });
  });
  it('refuses expired license activation and prevents reducing committed vehicle capacity', async () => {
    await service.driverStatus(admin, driverId, { status: 'inactive' });
    await service.updateDriver(admin, driverId, {
      licenseExpiresAt: '2000-01-01',
    });
    await expect(
      service.driverStatus(admin, driverId, { status: 'active' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.updateDriver(admin, driverId, {
      licenseExpiresAt: '2099-01-01',
    });
    await service.driverStatus(admin, driverId, { status: 'active' });
    await pg.query(
      "insert into public.rides(ride_id,driver_id,vehicle_id,status,available_seats) values($1,$2,$3,'scheduled',4)",
      [randomUUID(), driverId, vehicleId],
    );
    await expect(
      service.updateVehicle(admin, vehicleId, { capacity: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('soft deactivates vehicles and retains historical relationships', async () => {
    const result = await service.updateVehicle(admin, vehicleId, {
      status: 'inactive',
    });
    expect(result).toMatchObject({ isActive: false, status: 'inactive' });
    expect(
      (
        await pg.query(
          'select vehicle_id from public.vehicles where vehicle_id=$1',
          [vehicleId],
        )
      ).rows,
    ).toHaveLength(1);
    await service.updateVehicle(admin, vehicleId, { status: 'active' });
  });
  it('keeps documents private, requires actual matching upload and approved valid documents for readiness', async () => {
    const pending = await service.upload(admin, {
      driverId,
      kind: 'license',
      fileName: 'licencia.pdf',
      contentType: 'application/pdf',
      sizeBytes: 123,
      expiresAt: '2099-01-01',
    });
    const id = String(pending.document.documentId);
    expect(pending.path).toMatch(/^documents\/[0-9a-f-]+\.pdf$/);
    await expect(
      service.updateDocument(admin, id, { status: 'approved' }),
    ).rejects.toBeInstanceOf(ConflictException);
    fileSize = 124;
    await expect(service.completeUpload(admin, id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    fileSize = 123;
    await service.completeUpload(admin, id);
    await service.completeUpload(admin, id);
    await service.updateDocument(admin, id, { status: 'approved' });
    expect((await service.driver(admin, driverId)).compliance).toEqual({
      state: 'ready',
      reasons: [],
    });
    expect(await service.download(admin, id)).toEqual({
      signedUrl: 'https://synthetic.invalid/private-download',
      expiresIn: 60,
    });
    const audit = await service.audit(admin, {
      page: 1,
      pageSize: 100,
      entityId: id,
    });
    expect(JSON.stringify(audit)).not.toContain('synthetic-upload-token');
    expect(JSON.stringify(audit)).not.toContain(pending.path);
    const uploadedEvents = audit.items.filter((i) => i.action === 'uploaded');
    expect(uploadedEvents).toHaveLength(1);
  });
  it('rejects wrong document ownership, expired approvals and metadata-only uploads', async () => {
    await expect(
      service.upload(admin, {
        driverId,
        vehicleId,
        kind: 'license',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: 123,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload(admin, {
        driverId,
        kind: 'insurance',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: 123,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const upload = await service.upload(admin, {
      driverId,
      kind: 'other',
      fileName: 'x.pdf',
      contentType: 'application/pdf',
      sizeBytes: 123,
      expiresAt: '2000-01-01',
    });
    await service.completeUpload(admin, String(upload.document.documentId));
    await expect(
      service.updateDocument(admin, String(upload.document.documentId), {
        status: 'approved',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('protects private schema, immutable audit records and storage from non-admin JWTs', async () => {
    const permissions = (
      await pg.query<{
        private_read: boolean;
        audit_update: boolean;
        audit_delete: boolean;
        auth_read: boolean;
      }>(
        "select has_table_privilege('authenticated','krow_admin.documents','select') as private_read,has_table_privilege('krow_pilot_service','krow_admin.audit_log','update') as audit_update,has_table_privilege('krow_pilot_service','krow_admin.audit_log','delete') as audit_delete,has_table_privilege('krow_pilot_service','auth.users','select') as auth_read",
      )
    ).rows[0];
    expect(permissions).toEqual({
      private_read: false,
      audit_update: false,
      audit_delete: false,
      auth_read: false,
    });
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          userId,
        ]);
        await tx.query(
          "insert into storage.objects(bucket_id,name) values('krow-admin-documents',$1)",
          [`documents/${randomUUID()}.pdf`],
        );
      }),
    ).rejects.toThrow(/row-level security/);
    const bucket = (
      await pg.query<{ public: boolean; file_size_limit: string }>(
        'select public,file_size_limit from storage.buckets',
      )
    ).rows[0];
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(10485760);
  });
  it('limits and parameterizes paginated searches including literal wildcard characters', async () => {
    const none = await service.drivers(admin, {
      q: "%' or true--",
      page: 1,
      pageSize: 20,
    });
    expect(none.total).toBe(0);
    const next = await service.drivers(admin, { page: 999, pageSize: 1 });
    expect(next.items).toEqual([]);
    expect(next.total).toBe(2);
  });
  it('returns complete trip history with committed cents, participants, actual times and route after lifecycle version changes', async () => {
    const rideId = randomUUID(),
      pickup = randomUUID(),
      dropoff = randomUUID(),
      completed = randomUUID(),
      cancelled = randomUUID();
    await pg.query(
      "insert into public.rides(ride_id,driver_id,vehicle_id,status,available_seats,price_per_seat,departure_time,origin_lat,origin_lng,destination_lat,destination_lng,origin_address,destination_address,version,route_polyline) values($1,$2,$3,'completed',2,12.34,'2099-01-01T10:00:00Z',25.66,-100.24,25.7,-100.2,'ITNL','Destino',3,'synthetic-polyline')",
      [rideId, driverId, vehicleId],
    );
    await pg.query(
      "insert into public.ride_stops(stop_id,ride_id,lat,lng,address,stop_order,route_version) values($1,$3,25.66,-100.24,'ITNL',0,1),($2,$3,25.7,-100.2,'Destino',1,1)",
      [pickup, dropoff, rideId],
    );
    await pg.query(
      "insert into public.bookings(booking_id,ride_id,user_id,pickup_stop_id,dropoff_stop_id,seats_reserved,status) values($1,$3,$4,$5,$6,2,'completed'),($2,$3,$4,$5,$6,1,'cancelled')",
      [completed, cancelled, rideId, userId, pickup, dropoff],
    );
    await pg.query(
      'insert into krow_pilot.booking_prices(booking_id,amount_cents) values($1,2468),($2,1234)',
      [completed, cancelled],
    );
    await pg.query(
      "insert into krow_pilot.cash(booking_id,amount_cents,status) values($1,2468,'collected')",
      [completed],
    );
    await pg.query(
      "insert into public.ride_status_history(ride_id,status,previous_status,actor_id,changed_at) values($1,'in_progress','scheduled',$2,'2099-01-01T10:01:00Z'),($1,'completed','in_progress',$2,'2099-01-01T10:30:00Z')",
      [rideId, userId],
    );
    const ride = await service.ride(admin, rideId);
    expect(ride).toMatchObject({
      pricePerSeatCents: 1234,
      transportedPassengers: 2,
      grossAmountCents: 2468,
      collectedAmountCents: 2468,
      pendingAmountCents: 0,
    });
    expect(ride.route.stops.map((s) => s.stopId)).toEqual([pickup, dropoff]);
    expect(new Date(ride.startedAt ?? '').toISOString()).toBe(
      '2099-01-01T10:01:00.000Z',
    );
    expect(new Date(ride.endedAt ?? '').toISOString()).toBe(
      '2099-01-01T10:30:00.000Z',
    );
    expect(ride.passengers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookingId: completed,
          amountCents: 2468,
          cashStatus: 'collected',
        }),
        expect.objectContaining({ bookingId: cancelled, cashStatus: 'void' }),
      ]),
    );
    expect(
      (
        await service.rides(admin, {
          from: '2099-01-01',
          to: '2099-01-01',
          status: 'completed',
          page: 1,
          pageSize: 20,
        })
      ).total,
    ).toBe(1);
    await expect(
      service.rides(admin, {
        from: '2099-02-01',
        to: '2099-01-01',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('filters date-only values as complete local Monterrey days and preserves explicit ISO instants', async () => {
    const included = randomUUID(),
      before = randomUUID(),
      after = randomUUID();
    await pg.query(
      "insert into public.rides(ride_id,driver_id,vehicle_id,status,available_seats,price_per_seat,departure_time) values($1,$4,$5,'completed',1,10,'2099-02-02T05:59:59Z'),($2,$4,$5,'completed',1,10,'2099-02-01T05:59:59Z'),($3,$4,$5,'completed',1,10,'2099-02-02T06:00:00Z')",
      [included, before, after, driverId, vehicleId],
    );
    const local = await service.rides(admin, {
      from: '2099-02-01',
      to: '2099-02-01',
      page: 1,
      pageSize: 20,
    });
    expect(local.items.map((r) => r.rideId)).toEqual([included]);
    const explicit = await service.rides(admin, {
      from: '2099-02-02T05:59:59Z',
      to: '2099-02-02T06:00:00Z',
      page: 1,
      pageSize: 20,
    });
    expect(explicit.items.map((r) => r.rideId)).toEqual([included]);
  });
  it('rejects invalid filters, dates and file limits before handlers', async () => {
    expect(
      await validate(
        plainToInstance(AdminDriverListDto, {
          page: 0,
          pageSize: 101,
          status: 'admin',
        }),
      ),
    ).toHaveLength(3);
    expect(
      (
        await validate(
          plainToInstance(CreateAdminDriverDto, {
            email: 'bad',
            licenseNumber: '',
            licenseExpiresAt: '2099-02-30',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(CreateAdminDocumentDto, {
            kind: 'script',
            contentType: 'text/html',
            sizeBytes: 11 * 1024 * 1024,
            fileName: 'x',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rolls back administrative change when its audit insert fails', async () => {
    const before = await service.driver(admin, driverId);
    await expect(
      adminTransaction(db, admin, async (client) => {
        await client.query(
          "update public.driver_profiles set status='suspended' where driver_id=$1",
          [driverId],
        );
        await client.query(
          "insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id) values($1,'bad','unknown',$2)",
          [admin.id, driverId],
        );
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.driver(admin, driverId)).approvalStatus).toBe(
      before.approvalStatus,
    );
  });
});
