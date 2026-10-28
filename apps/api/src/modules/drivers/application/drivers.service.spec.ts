import { PGlite } from '@electric-sql/pglite';
import { jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { PilotDatabase } from '../../pilot/pilot.database.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { DriversService } from './drivers.service.js';

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const userFor = (n: number): AuthenticatedUser => ({
  id: uid(n),
  email: null,
  accessToken: 'synthetic',
  appMetadata: {},
  userMetadata: { role: 'admin' }, // editable por el usuario: no debe dar acceso
});
const driverA = userFor(1);
const driverB = userFor(2);

describe('driver validation', () => {
  it('rejects a weekly report that does not start on Monday or has a bad date', async () => {
    const transaction = jest.fn();
    const service = new DriversService({ transaction } as unknown as PilotDatabase);
    for (const weekStart of ['2026-10-20', '2026-10-25', '2026-02-30', '2026-10-19T00:00:00Z'])
      await expect(service.weeklyReport(driverA, { weekStart })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  const transaction = jest.fn();
  const service = new DriversService({
    transaction,
  } as unknown as PilotDatabase);
  beforeEach(() => transaction.mockClear());
  it.each([
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-07T00:00:00Z', to: '2026-10-07' },
    { from: '2026-10-08', to: '2026-10-07' },
    { from: '2025-01-01', to: '2026-10-07' },
  ])('rejects invalid dates before database access: %j', async (query) => {
    await expect(
      service.dashboardSummary(driverA, query),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.rides(driverA, query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid pagination before database access', async () => {
    const range = { from: '2026-10-07', to: '2026-10-07' };
    for (const page of [{ page: '0' }, { pageSize: '51' }, { page: '1.5' }])
      await expect(
        service.rides(driverA, { ...range, ...page }),
      ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

class EmbeddedDriversDatabase extends PilotDatabase {
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

describe('driver endpoints run on PostgreSQL and only see their own data', () => {
  let postgres: PGlite;
  let service: DriversService;
  beforeAll(async () => {
    postgres = new PGlite();
    await postgres.waitReady;
    await postgres.exec(`
      create schema krow_pilot;
      create table public.users(uuid uuid primary key,full_name text,email_address text,profile_photo text,
        academic_program text,academic_period integer,is_active boolean,deleted_at timestamptz);
      create table public.driver_profiles(driver_id uuid primary key,user_id uuid,license_number text,
        license_expiry date,rating numeric,status text,admin_status text,created_at timestamptz default now());
      create table public.rides(ride_id uuid primary key,driver_id uuid,status text,departure_time timestamptz,
        origin_address text,destination_address text,available_seats integer,price_per_seat numeric);
      create table public.bookings(booking_id uuid primary key,ride_id uuid,status text,seats_reserved integer,payment_method text);
      create table krow_pilot.booking_prices(booking_id uuid primary key,amount_cents integer);
      create table krow_pilot.cash(booking_id uuid primary key,amount_cents integer,status text);
    `);
    service = new DriversService(new EmbeddedDriversDatabase(postgres));
  }, 30000);
  afterAll(async () => postgres.close());
  beforeEach(async () => {
    await postgres.exec(
      'truncate public.users,public.driver_profiles,public.rides,public.bookings,krow_pilot.booking_prices,krow_pilot.cash',
    );
    for (const n of [1, 2]) {
      await postgres.query(
        `insert into public.users(uuid,full_name,email_address,profile_photo,academic_program,academic_period,is_active)
         values($1,$2,$3,$4,'Ingeniería en Sistemas',5,true)`,
        [uid(n), `Conductor ${n}`, `c${n}@example.com`, n === 1 ? 'https://cdn.example/a.jpg' : null],
      );
      await postgres.query(
        `insert into public.driver_profiles(driver_id,user_id,license_number,license_expiry,rating,status,admin_status,created_at)
         values($1,$1,$2,'2027-03-15',4.8,'approved','active','2026-01-10T12:00:00Z')`,
        [uid(n), `LIC-${n}`],
      );
    }
  });
  const range = { from: '2026-10-07', to: '2026-10-08' };

  it('identifies an approved, active driver', async () => {
    expect(await service.me(driverA)).toEqual({ driver_id: uid(1) });
  });

  it.each([
    ['has no driver profile', () => postgres.exec('delete from public.driver_profiles')],
    ['is still pending approval', () => postgres.exec("update public.driver_profiles set status='pending'")],
    ['was suspended by an administrator', () => postgres.exec("update public.driver_profiles set admin_status='suspended'")],
    ['belongs to a deactivated account', () => postgres.exec('update public.users set is_active=false')],
  ])('denies an account that %s, ignoring forged metadata', async (_name, setup) => {
    await setup();
    await expect(service.me(driverA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.dashboardSummary(driverA, range)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.rides(driverA, range)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.profile(driverA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.weeklyReport(driverA, { weekStart: '2026-10-19' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('summarizes only the caller trips, keeping cents and excluding cancellations', async () => {
    await postgres.exec(`
      insert into public.rides values
        ('${uid(11)}','${uid(1)}','completed','2026-10-07T06:00:00Z','Campus','A',2,99.99),
        ('${uid(12)}','${uid(1)}','scheduled','2026-10-08T06:00:00Z','Campus','B',3,25.05),
        ('${uid(13)}','${uid(1)}','cancelled','2026-10-07T16:00:00Z','Campus','A',4,88),
        ('${uid(14)}','${uid(2)}','completed','2026-10-07T17:00:00Z','Campus','A',1,500);
      insert into public.bookings values
        ('${uid(21)}','${uid(11)}','completed',2),
        ('${uid(22)}','${uid(12)}','confirmed',1),
        ('${uid(23)}','${uid(13)}','cancelled',1),
        ('${uid(24)}','${uid(14)}','completed',3);
      insert into krow_pilot.booking_prices values('${uid(21)}',2468),('${uid(24)}',150000);
      insert into krow_pilot.cash values('${uid(21)}',2468,'collected'),('${uid(24)}',150000,'collected');
    `);
    const summary = await service.dashboardSummary(driverA, range);
    expect(summary).toMatchObject({
      completed: 1,
      cancelled: 1,
      scheduled: 1,
      totalTrips: 3,
      passengers: 2,
      reservedPassengers: 3,
      revenue: 49.73,
      paid: 24.68,
      pending: 25.05,
      occupancy: 37.5,
      timezone: 'America/Monterrey',
      currency: 'MXN',
    });
    expect(summary).not.toHaveProperty('activeDrivers');
    expect(summary.trend).toEqual([
      { date: '2026-10-07', completed: 1, cancelled: 1, revenue: 24.68 },
      { date: '2026-10-08', completed: 0, cancelled: 0, revenue: 25.05 },
    ]);
    expect(summary.topRoutes.find((r) => r.route === 'Campus → A')).toMatchObject({
      trips: 1,
      occupancy: 50,
    });
    const other = await service.dashboardSummary(driverB, range);
    expect(other).toMatchObject({ totalTrips: 1, passengers: 3, revenue: 1500, paid: 1500 });
  });

  it('returns real empty totals for a driver without trips', async () => {
    expect(await service.dashboardSummary(driverA, range)).toMatchObject({
      totalTrips: 0,
      passengers: 0,
      occupancy: 0,
      revenue: 0,
      paid: 0,
      pending: 0,
      topRoutes: [],
    });
  });

  it('lists completed trips newest first, paginated, with passengers and amount', async () => {
    await postgres.exec(`
      insert into public.rides select gen_random_uuid(),'${uid(1)}','completed',
        ('2026-10-07T12:00:00Z'::timestamptz + (g||' hours')::interval),'Campus','A',4,10
        from generate_series(1,12) g;
      insert into public.rides values('${uid(30)}','${uid(1)}','cancelled','2026-10-07T20:00:00Z','Campus','A',4,10);
      insert into public.rides values('${uid(31)}','${uid(2)}','completed','2026-10-07T20:00:00Z','Campus','A',4,10);
    `);
    const first = await service.rides(driverA, { ...range, status: 'completed', pageSize: '5' });
    expect(first).toMatchObject({ total: 12, page: 1, pageSize: 5 });
    expect(first.items).toHaveLength(5);
    const times = first.items.map((i) => Date.parse(i.departureTime));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const last = await service.rides(driverA, { ...range, status: 'completed', pageSize: '5', page: '3' });
    expect(last.items).toHaveLength(2);
    const beyond = await service.rides(driverA, { ...range, status: 'completed', page: '9' });
    expect(beyond).toMatchObject({ items: [], total: 12 });
  });

  it('computes passengers and amount per trip and tolerates missing addresses', async () => {
    await postgres.exec(`
      insert into public.rides values
        ('${uid(41)}','${uid(1)}','completed','2026-10-07T12:00:00Z','ITNL','Centro',2,30.5),
        ('${uid(42)}','${uid(1)}','completed','2026-10-07T10:00:00Z',null,null,2,10);
      insert into public.bookings values
        ('${uid(51)}','${uid(41)}','completed',2),
        ('${uid(52)}','${uid(41)}','cancelled',1);
    `);
    const { items } = await service.rides(driverA, { ...range, status: 'completed' });
    expect(items[0]).toMatchObject({
      rideId: uid(41),
      originAddress: 'ITNL',
      destinationAddress: 'Centro',
      passengers: 2,
      amount: 61,
    });
    expect(items[1]).toMatchObject({ originAddress: null, destinationAddress: null, passengers: 0, amount: 0 });
  });

  it('uses local inclusive calendar boundaries and an optional status filter', async () => {
    await postgres.exec(`insert into public.rides select gen_random_uuid(),'${uid(1)}','completed',t,'Campus','A',4,1
      from unnest(array['2026-10-07T05:59:59.999Z','2026-10-07T06:00:00Z',
        '2026-10-08T05:59:59.999Z','2026-10-08T06:00:00Z']::timestamptz[]) t;
      insert into public.rides values(gen_random_uuid(),'${uid(1)}','cancelled','2026-10-07T18:00:00Z','Campus','A',4,1)`);
    const day = { from: '2026-10-07', to: '2026-10-07' };
    expect((await service.rides(driverA, { ...day, status: 'completed' })).total).toBe(2);
    expect((await service.rides(driverA, day)).total).toBe(3);
  });

  it('returns the profile with the useful data only and no identifiers', async () => {
    const profile = await service.profile(driverA);
    expect(profile).toEqual({
      fullName: 'Conductor 1',
      email: 'c1@example.com',
      photoUrl: 'https://cdn.example/a.jpg',
      academicProgram: 'Ingeniería en Sistemas',
      academicPeriod: 5,
      licenseNumber: 'LIC-1',
      licenseExpiry: '2027-03-15',
      rating: 4.8,
      status: 'approved',
      memberSince: expect.any(String),
    });
    expect(JSON.stringify(profile)).not.toContain(uid(1));
    const other = await service.profile(driverB);
    expect(other.fullName).toBe('Conductor 2');
    expect(other.photoUrl).toBeNull();
  });

  describe('weekly report (Monday to Sunday, Monterrey time)', () => {
    const week = { weekStart: '2026-10-19' };

    it('pays the driver $20 per passenger, cash or card, and keeps the rest as retained', async () => {
      // Tablas de costos: el viaje cuesta 35.00 y el "pago del alumno" es 20.00.
      await postgres.exec(`
        insert into public.rides values
          ('${uid(11)}','${uid(1)}','completed','2026-10-21T15:00:00Z','ITNL','Centro',2,35),
          ('${uid(12)}','${uid(1)}','scheduled','2026-10-22T15:00:00Z','ITNL','Centro',4,35),
          ('${uid(13)}','${uid(2)}','completed','2026-10-21T16:00:00Z','ITNL','Centro',2,35);
        insert into public.bookings(booking_id,ride_id,status,seats_reserved,payment_method) values
          ('${uid(21)}','${uid(11)}','completed',1,'cash'),
          ('${uid(22)}','${uid(11)}','completed',1,'card'),
          ('${uid(23)}','${uid(11)}','cancelled',1,'cash'),
          ('${uid(24)}','${uid(11)}','confirmed',1,'cash'),
          ('${uid(25)}','${uid(12)}','completed',1,'cash'),
          ('${uid(26)}','${uid(13)}','completed',3,'cash');
        insert into krow_pilot.booking_prices values('${uid(21)}',3500),('${uid(22)}',3500);
      `);
      const report = await service.weeklyReport(driverA, week);
      expect(report).toMatchObject({
        driverName: 'Conductor 1',
        weekStart: '2026-10-19',
        weekEnd: '2026-10-25',
        currency: 'MXN',
        timezone: 'America/Monterrey',
        payPerPassenger: 20,
        totals: { trips: 1, passengers: 2, gross: 70, retained: 30, net: 40 },
      });
      expect(report.byMethod).toEqual([
        { method: 'cash', payments: 1, passengers: 1, gross: 35, retained: 15, net: 20 },
        { method: 'card', payments: 1, passengers: 1, gross: 35, retained: 15, net: 20 },
      ]);
      expect(report).not.toHaveProperty('margins');
      expect(report.trips).toHaveLength(1);
      expect(report.trips[0]).toMatchObject({
        rideId: uid(11),
        originAddress: 'ITNL',
        destinationAddress: 'Centro',
        passengers: 2,
        gross: 70,
        retained: 30,
        net: 40,
      });
    });

    it('pays per seat, whatever the booking price is', async () => {
      await postgres.exec(`
        insert into public.rides values('${uid(30)}','${uid(1)}','completed','2026-10-20T15:00:00Z','A','B',2,35);
        insert into public.bookings(booking_id,ride_id,status,seats_reserved,payment_method) values
          ('${uid(31)}','${uid(30)}','completed',3,'cash'),
          ('${uid(32)}','${uid(30)}','completed',1,'card');
        insert into krow_pilot.booking_prices values('${uid(31)}',9000),('${uid(32)}',2100);
      `);
      expect((await service.weeklyReport(driverA, week)).totals).toMatchObject({
        passengers: 4,
        gross: 111,
        retained: 31,
        net: 80,
      });
    });

    it('falls back to the seat price and ignores payments voided in cash', async () => {
      await postgres.exec(`
        insert into public.rides values('${uid(40)}','${uid(1)}','completed','2026-10-20T15:00:00Z','A','B',2,25.05);
        insert into public.bookings(booking_id,ride_id,status,seats_reserved) values
          ('${uid(41)}','${uid(40)}','completed',2),
          ('${uid(42)}','${uid(40)}','completed',1);
        insert into krow_pilot.cash values('${uid(41)}',5010,'collected'),('${uid(42)}',2505,'voided');
      `);
      expect((await service.weeklyReport(driverA, week)).totals).toMatchObject({
        passengers: 2,
        gross: 50.1,
        retained: 10.1,
        net: 40,
      });
    });

    it('treats every payment as cash when bookings has no payment_method column', async () => {
      await postgres.exec('alter table public.bookings drop column payment_method');
      try {
        await postgres.exec(`
          insert into public.rides values('${uid(50)}','${uid(1)}','completed','2026-10-20T15:00:00Z','A','B',2,35);
          insert into public.bookings(booking_id,ride_id,status,seats_reserved) values('${uid(51)}','${uid(50)}','completed',1);
        `);
        const { byMethod, totals } = await service.weeklyReport(driverA, week);
        expect(byMethod[0]).toMatchObject({ method: 'cash', payments: 1, net: 20 });
        expect(byMethod[1]).toMatchObject({ method: 'card', payments: 0, gross: 0, net: 0 });
        expect(totals.net).toBe(20);
      } finally {
        await postgres.exec('alter table public.bookings add column payment_method text');
      }
    });

    it('uses local inclusive week boundaries', async () => {
      await postgres.exec(`insert into public.rides select gen_random_uuid(),'${uid(1)}','completed',t,'Campus','A',4,1
        from unnest(array['2026-10-19T05:59:59.999Z','2026-10-19T06:00:00Z',
          '2026-10-26T05:59:59.999Z','2026-10-26T06:00:00Z']::timestamptz[]) t`);
      expect((await service.weeklyReport(driverA, week)).totals.trips).toBe(2);
    });

    it('lists completed trips without passengers and returns real zeros for an empty week', async () => {
      await postgres.exec(`insert into public.rides values('${uid(60)}','${uid(1)}','completed','2026-10-21T15:00:00Z','A','B',4,35)`);
      const withTrip = await service.weeklyReport(driverA, week);
      expect(withTrip.trips[0]).toMatchObject({ passengers: 0, gross: 0, retained: 0, net: 0 });
      const empty = await service.weeklyReport(driverA, { weekStart: '2026-10-12' });
      expect(empty.totals).toEqual({ trips: 0, passengers: 0, gross: 0, retained: 0, net: 0 });
      expect(empty.trips).toEqual([]);
      expect(empty.byMethod.map((m) => m.method)).toEqual(['cash', 'card']);
    });
  });
});
