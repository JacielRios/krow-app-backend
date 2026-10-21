import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

describe('launch profile, catalog and payment permissions migrations', () => {
  let db: PGlite;
  const actor = randomUUID();
  const corridor = randomUUID();
  const incomplete = randomUUID();
  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`create role anon; create role authenticated;create role krow_pilot_service;
      create schema auth;create schema private;create schema krow_pilot;create schema krow_admin;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function private.is_current_admin() returns boolean language sql as $$select current_setting('request.jwt.claim.sub',true)='${actor}'$$;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create table public.users(uuid uuid primary key,full_name text,email_address text,profile_photo text,institutional_id text unique,academic_program text,academic_period bigint,is_active boolean default true,deleted_at timestamptz);
      create function private.is_admin_actor() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.users where uuid=auth.uid() and is_active is distinct from false and deleted_at is null)$$;
      create table public.payments(payment_id uuid primary key,status text);
      grant usage on schema public to authenticated;
      grant insert,update,delete on public.payments to authenticated;
      alter table public.payments enable row level security;
      create policy payments_insert_booker on public.payments for insert to authenticated with check(true);
      create table krow_pilot.outbox(status text,lease_until timestamptz,expires_at timestamptz);
      create table public.transport_corridors(corridor_id uuid primary key,active boolean);
      create table public.transport_stops(stop_id uuid primary key default gen_random_uuid(),external_id text unique,name text,address text,municipality text,latitude double precision,longitude double precision,source text,active boolean,stop_type text,corridor_id uuid,corridor_order integer,direction text,updated_at timestamptz);
      create table public.rides(ride_id uuid primary key,status text);
      create table public.ride_stops(stop_id uuid primary key,ride_id uuid,transport_stop_id uuid);
      create table public.bookings(booking_id uuid primary key,ride_id uuid,pickup_stop_id uuid,dropoff_stop_id uuid,status text);
      create table krow_admin.audit_log(actor_id uuid,action text,entity_type text constraint audit_log_entity_type_check check(entity_type in('driver','vehicle','document')),entity_id uuid,changes jsonb);
      insert into public.transport_corridors values('${corridor}',true);
      insert into auth.users values('${actor}','admin@example.invalid','{}');
      insert into public.users(uuid,full_name) values('${actor}','Administrator');
      insert into krow_pilot.outbox values('pending',null,now()-interval '1 day');`);
    for (const file of [
      '20261016175150_launch_profile_security.sql',
      '20261016175213_admin_corridor_stops.sql',
      '20261016175940_harden_admin_stop_actor.sql',
    ]) {
      if (file.includes('launch_profile')) {
        await db.query('insert into auth.users values($1,$2,$3)', [
          incomplete,
          'incomplete@example.invalid',
          {
            full_name: 'Original',
            institutional_id: 'REPAIR-1',
            academic_program: 'Sistemas',
            academic_period: '7',
          },
        ]);
        await db.query(
          'insert into public.users(uuid,full_name) values($1,$2)',
          [incomplete, 'Nombre editado'],
        );
      }
      await db.exec(
        await readFile(
          new URL(
            `../../../../../supabase/migrations/${file}`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    }
    await db.exec(
      'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()',
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
  });
  afterAll(async () => {
    await db?.close();
  });
  const save = async (payload: Record<string, unknown>) =>
    (
      await db.query<{ id: string }>(
        'select public.admin_upsert_transport_stop($1::jsonb) id',
        [payload],
      )
    ).rows[0].id;
  const payload = (overrides: Record<string, unknown> = {}) => ({
    external_id: randomUUID(),
    name: 'Referencia',
    latitude: 25.7,
    longitude: -100.2,
    corridor_id: corridor,
    corridor_order: 10,
    active: true,
    stop_type: 'general',
    ...overrides,
  });
  it('repairs existing academic fields without overwriting the edited name', async () => {
    expect(
      (
        await db.query(
          'select full_name,institutional_id,academic_program,academic_period from public.users where uuid=$1',
          [incomplete],
        )
      ).rows[0],
    ).toEqual({
      full_name: 'Nombre editado',
      institutional_id: 'REPAIR-1',
      academic_program: 'Sistemas',
      academic_period: 7,
    });
  });
  it('stores signup academics without requiring an authenticated session', async () => {
    const id = randomUUID();
    await db.query('insert into auth.users values($1,$2,$3)', [
      id,
      'student@example.invalid',
      {
        full_name: 'Estudiante',
        institutional_id: 'A-1',
        academic_program: 'Sistemas',
        academic_period: '5',
      },
    ]);
    const row = (
      await db.query('select * from public.users where uuid=$1', [id])
    ).rows[0];
    expect(row).toMatchObject({
      institutional_id: 'A-1',
      academic_program: 'Sistemas',
      academic_period: 5,
    });
  });
  it('does not break signup for malformed metadata or a duplicate institutional ID', async () => {
    const id = randomUUID();
    await db.query('insert into auth.users values($1,$2,$3)', [
      id,
      'other@example.invalid',
      { institutional_id: 'A-1', academic_period: 'not-an-integer' },
    ]);
    expect(
      (
        await db.query(
          'select institutional_id,academic_period from public.users where uuid=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ institutional_id: null, academic_period: null });
  });
  it('removes client permission to certify a legacy payment', async () => {
    expect(
      (
        await db.query(
          "select has_table_privilege('authenticated','public.payments','INSERT') allowed",
        )
      ).rows[0],
    ).toEqual({ allowed: false });
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("insert into public.payments values($1,'paid')", [
          randomUUID(),
        ]);
      }),
    ).rejects.toThrow(/permission denied/);
  });
  it('expires the disabled push backlog', async () => {
    expect(
      (await db.query('select status from krow_pilot.outbox')).rows[0],
    ).toEqual({ status: 'expired' });
  });
  it('persists avenue, order and direction with an audit record', async () => {
    const id = await save(payload({ direction: 'Oriente' }));
    expect(
      (
        await db.query(
          'select corridor_id,corridor_order,direction from public.transport_stops where stop_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({
      corridor_id: corridor,
      corridor_order: 10,
      direction: 'Oriente',
    });
    expect(
      (
        await db.query(
          'select count(*)::int n from krow_admin.audit_log where entity_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });
  it('rejects duplicate order and unauthorized catalog changes', async () => {
    await expect(save(payload())).rejects.toThrow(/orden.*uso/);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          randomUUID(),
        ]);
        await tx.query('select public.admin_upsert_transport_stop($1::jsonb)', [
          payload({ corridor_order: 11 }),
        ]);
      }),
    ).rejects.toThrow(/administrativo/);
  });
  it('denies a deactivated admin even while its token still claims admin', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          'update public.users set is_active=false where uuid=$1',
          [actor],
        );
        await tx.query('select public.admin_upsert_transport_stop($1::jsonb)', [
          payload({ corridor_order: 12 }),
        ]);
      }),
    ).rejects.toThrow(/administrativo/);
    expect(
      (
        await db.query('select is_active from public.users where uuid=$1', [
          actor,
        ])
      ).rows[0],
    ).toEqual({ is_active: true });
  });
  it('keeps legacy updates compatible and prevents deactivation of a booked stop', async () => {
    const id = await save(payload({ corridor_order: 20 }));
    const ride = randomUUID(),
      rideStop = randomUUID();
    await db.query("insert into public.rides values($1,'scheduled')", [ride]);
    await db.query('insert into public.ride_stops values($1,$2,$3)', [
      rideStop,
      ride,
      id,
    ]);
    await db.query(
      "insert into public.bookings values($1,$2,$3,$3,'confirmed')",
      [randomUUID(), ride, rideStop],
    );
    const legacy: Record<string, unknown> = payload({ stop_id: id });
    delete legacy.corridor_id;
    delete legacy.corridor_order;
    await save(legacy);
    expect(
      (
        await db.query(
          'select corridor_order from public.transport_stops where stop_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ corridor_order: 20 });
    await expect(save({ ...legacy, active: false })).rejects.toThrow(
      /reservas pendientes/,
    );
  });
});
