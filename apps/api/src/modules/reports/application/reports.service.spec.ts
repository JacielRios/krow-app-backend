import { PGlite } from '@electric-sql/pglite';
import { jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { PilotDatabase } from '../../pilot/pilot.database.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { ReportsService } from './reports.service.js';

const admin: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: null,
  accessToken: 'synthetic',
  appMetadata: { role: 'admin' },
  userMetadata: {},
};

describe('reports validation', () => {
  const transaction = jest.fn();
  const service = new ReportsService({
    transaction,
  } as unknown as PilotDatabase);
  beforeEach(() => transaction.mockClear());
  it.each([
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-07T00:00:00Z', to: '2026-10-07' },
    { from: '2026-10-08', to: '2026-10-07' },
    { from: '2025-01-01', to: '2026-10-07' },
  ])('rejects invalid dates before database access: %j', async (query) => {
    await expect(service.dashboardSummary(admin, query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects a role forged in editable user_metadata', async () => {
    await expect(
      service.dashboardSummary(
        { ...admin, appMetadata: {}, userMetadata: { role: 'admin' } },
        { from: '2026-10-07', to: '2026-10-07' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

class EmbeddedReportsDatabase extends PilotDatabase {
  constructor(private readonly postgres: PGlite) {
    super(new ConfigService({ RIDE_PILOT_ENABLED: 'true' }));
  }
  override async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.postgres.transaction(async (tx) =>
      work({
        query: async (sql: string, values: unknown[] = []) =>
          tx.query(sql, values),
      } as unknown as PoolClient),
    );
  }
}

describe('administrative reports aggregate on PostgreSQL', () => {
  let postgres: PGlite;
  let service: ReportsService;
  beforeAll(async () => {
    postgres = new PGlite();
    await postgres.waitReady;
    await postgres.exec(`
      create schema auth; create schema private; create schema krow_pilot;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.users(uuid uuid primary key,is_active boolean,deleted_at timestamptz);
      create function private.is_admin_actor() returns boolean language sql stable as $$
        select exists(select 1 from auth.users a join public.users u on u.uuid=a.id
          where a.id=auth.uid() and a.raw_app_meta_data->>'role'='admin'
          and u.is_active is distinct from false and u.deleted_at is null) $$;
      create table public.driver_profiles(driver_id uuid primary key,user_id uuid,status text,admin_status text);
      create table public.rides(ride_id uuid primary key,status text,departure_time timestamptz,
        origin_address text,destination_address text,available_seats integer,price_per_seat numeric);
      create table public.bookings(booking_id uuid primary key,ride_id uuid,status text,seats_reserved integer);
      create table krow_pilot.booking_prices(booking_id uuid primary key,amount_cents integer);
      create table krow_pilot.cash(booking_id uuid primary key,amount_cents integer,status text);
    `);
    service = new ReportsService(new EmbeddedReportsDatabase(postgres));
  }, 30000);
  afterAll(async () => postgres.close());
  beforeEach(async () => {
    await postgres.exec(
      'truncate auth.users,public.users,public.driver_profiles,public.rides,public.bookings,krow_pilot.booking_prices,krow_pilot.cash',
    );
    await postgres.query('insert into auth.users values($1,$2)', [
      admin.id,
      { role: 'admin' },
    ]);
    await postgres.query('insert into public.users values($1,true,null)', [
      admin.id,
    ]);
    await postgres.query(
      "insert into public.driver_profiles values($1,$1,'approved','active')",
      [admin.id],
    );
  });
  const range = { from: '2026-10-07', to: '2026-10-08' };
  it('keeps cents, separates future reservations, excludes cancellations and weights occupancy', async () => {
    await postgres.exec(`
      insert into public.rides values
        ('00000000-0000-0000-0000-000000000011','completed','2026-10-07T06:00:00Z','Campus','A',2,99.99),
        ('00000000-0000-0000-0000-000000000012','scheduled','2026-10-08T06:00:00Z','Campus','B',3,25.05),
        ('00000000-0000-0000-0000-000000000013','cancelled','2026-10-07T16:00:00Z','Campus','A',4,88);
      insert into public.bookings values
        ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','completed',2),
        ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012','confirmed',1),
        ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000013','cancelled',1);
      insert into krow_pilot.booking_prices values('00000000-0000-0000-0000-000000000021',2468);
      insert into krow_pilot.cash values('00000000-0000-0000-0000-000000000021',2468,'collected');
    `);
    const summary = await service.dashboardSummary(admin, range);
    expect(summary).toMatchObject({
      completed: 1,
      cancelled: 1,
      scheduled: 1,
      totalTrips: 3,
      activeDrivers: 1,
      inactiveDrivers: 0,
      passengers: 2,
      reservedPassengers: 3,
      revenue: 49.73,
      paid: 24.68,
      pending: 25.05,
      occupancy: 37.5,
      timezone: 'America/Monterrey',
      currency: 'MXN',
    });
    expect(summary.trend).toEqual([
      { date: '2026-10-07', completed: 1, cancelled: 1, revenue: 24.68 },
      { date: '2026-10-08', completed: 0, cancelled: 0, revenue: 25.05 },
    ]);
    expect(
      summary.topRoutes.find((route) => route.route === 'Campus → A'),
    ).toMatchObject({ trips: 1, occupancy: 50 });
  });
  it('uses local inclusive calendar boundaries, including the last millisecond', async () => {
    await postgres.exec(`insert into public.rides select gen_random_uuid(),'completed',t,'Campus','A',4,1
      from unnest(array['2026-10-07T05:59:59.999Z','2026-10-07T06:00:00Z',
        '2026-10-08T05:59:59.999Z','2026-10-08T06:00:00Z']::timestamptz[]) t`);
    const summary = await service.dashboardSummary(admin, {
      from: '2026-10-07',
      to: '2026-10-07',
    });
    expect(summary.completed).toBe(2);
    expect(summary.trend).toHaveLength(1);
  });
  it('does not truncate more than 1000 trips and includes empty days', async () => {
    await postgres.exec(
      "insert into public.rides select gen_random_uuid(),'scheduled','2026-10-07T16:00:00Z','Campus','A',4,1 from generate_series(1,1101)",
    );
    const summary = await service.dashboardSummary(admin, range);
    expect(summary.totalTrips).toBe(1101);
    expect(summary.trend[1]).toEqual({
      date: '2026-10-08',
      completed: 0,
      cancelled: 0,
      revenue: 0,
    });
  });
  it('returns real empty totals and includes suspended/deactivated drivers as inactive', async () => {
    await postgres.exec(
      "update public.driver_profiles set status='suspended',admin_status='suspended'",
    );
    expect(await service.dashboardSummary(admin, range)).toMatchObject({
      totalTrips: 0,
      activeDrivers: 0,
      inactiveDrivers: 1,
      passengers: 0,
      occupancy: 0,
      revenue: 0,
      paid: 0,
      pending: 0,
      topRoutes: [],
    });
  });
  it('counts full trips among scheduled departures', async () => {
    await postgres.exec(
      "insert into public.rides values(gen_random_uuid(),'full','2026-10-07T16:00:00Z','Campus','A',0,12.34)",
    );
    expect(await service.dashboardSummary(admin, range)).toMatchObject({
      totalTrips: 1,
      scheduled: 1,
    });
  });
  it('denies a demoted administrator even with old metadata in the request', async () => {
    await postgres.exec("update auth.users set raw_app_meta_data='{}'");
    await expect(service.dashboardSummary(admin, range)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('denies an inactive account', async () => {
    await postgres.exec('update public.users set is_active=false');
    await expect(service.dashboardSummary(admin, range)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
