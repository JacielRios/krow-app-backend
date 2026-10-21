import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import type { UpsertProfileDto } from './profile.dto.js';
import { PilotDatabase } from '../pilot/pilot.database.js';
import type { Database } from '../../infrastructure/supabase/database.types.js';

type ProfileRow = Pick<
  Database['public']['Tables']['users']['Row'],
  | 'uuid'
  | 'full_name'
  | 'profile_photo'
  | 'rating'
  | 'institutional_id'
  | 'academic_program'
  | 'academic_period'
>;
type DriverRow = Pick<
  Database['public']['Tables']['driver_profiles']['Row'],
  'driver_id' | 'status' | 'rating'
>;

@Injectable()
export class UsersService {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly pilot?: PilotDatabase,
  ) {}

  async me(user: AuthenticatedUser) {
    let data = await this.profile(user);
    if (!data) {
      const period = Number(user.userMetadata.academic_period);
      await this.upsertProfile(user, {
        fullName: this.metadataString(user, 'full_name') ?? '',
        institutionalId: this.metadataString(user, 'institutional_id') ?? '',
        academicProgram: this.metadataString(user, 'academic_program') ?? '',
        academicPeriod:
          Number.isInteger(period) && period >= 1 && period <= 20
            ? period
            : null,
      });
      data = await this.profile(user);
    }
    let driver: DriverRow | null;
    if (this.pilot?.enabled) {
      driver =
        (
          await this.pilot.query<DriverRow>(
            'select driver_id,status,rating from public.driver_profiles where user_id=$1',
            [user.id],
          )
        )[0] ?? null;
    } else {
      const result = await this.supabase
        .forUser(user.accessToken)
        .from('driver_profiles')
        .select('driver_id, status, rating')
        .eq('user_id', user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      driver = result.data;
    }

    return {
      userId: data?.uuid ?? user.id,
      email: user.email,
      fullName: data?.full_name ?? this.metadataString(user, 'full_name'),
      profilePhoto: data?.profile_photo ?? null,
      institutionalId: data
        ? data.institutional_id
        : this.metadataString(user, 'institutional_id'),
      academicProgram: data
        ? data.academic_program
        : this.metadataString(user, 'academic_program'),
      academicPeriod: data?.academic_period ?? null,
      capabilities: { passenger: true, driver: driver?.status === 'approved' },
      rating: data?.rating == null ? null : Number(data.rating),
      role: driver ? 'conductor' : 'pasajero',
      canPublishRides: driver?.status === 'approved',
      driverProfile: driver
        ? {
            driverId: driver.driver_id,
            status: driver.status,
            rating: driver.rating == null ? null : Number(driver.rating),
          }
        : null,
    };
  }

  async upsertProfile(user: AuthenticatedUser, profile: UpsertProfileDto) {
    if (this.pilot?.enabled) {
      try {
        await this.pilot.transaction(async (client) => {
          const { rows } = await client.query<{
            is_active: boolean | null;
            deleted_at: Date | null;
          }>(
            'select is_active,deleted_at from public.users where uuid=$1 for update',
            [user.id],
          );
          if (rows[0]?.is_active === false || rows[0]?.deleted_at)
            throw new ForbiddenException('Esta cuenta está desactivada');
          await client.query(
            `insert into public.users(uuid,email_address,full_name,institutional_id,academic_program,academic_period,profile_photo) values($1,$2,$3,$4,$5,$6,$7)
          on conflict(uuid) do update set email_address=excluded.email_address,full_name=excluded.full_name,institutional_id=excluded.institutional_id,academic_program=excluded.academic_program,academic_period=excluded.academic_period,profile_photo=case when $8 then excluded.profile_photo else public.users.profile_photo end`,
            [
              user.id,
              user.email,
              profile.fullName,
              profile.institutionalId.trim() || null,
              profile.academicProgram,
              profile.academicPeriod ?? null,
              profile.profilePhoto ?? null,
              Object.hasOwn(profile, 'profilePhoto'),
            ],
          );
        });
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        )
          throw new ConflictException(
            'El correo o la matrícula ya están vinculados a otra cuenta.',
          );
        throw error;
      }
      return { success: true };
    }
    const { error } = await this.supabase
      .forUser(user.accessToken)
      .from('users')
      .upsert(
        {
          uuid: user.id,
          email_address: user.email,
          full_name: profile.fullName,
          institutional_id: profile.institutionalId.trim() || null,
          academic_program: profile.academicProgram,
          academic_period: profile.academicPeriod ?? null,
          ...(Object.hasOwn(profile, 'profilePhoto')
            ? { profile_photo: profile.profilePhoto }
            : {}),
        },
        { onConflict: 'uuid' },
      );
    if (error) throw error;
    return { success: true };
  }

  async driverMetrics(user: AuthenticatedUser) {
    if (!this.pilot?.enabled)
      throw new ForbiddenException('Las métricas requieren el piloto activo');
    const [row] = await this.pilot.query<{ metrics: Record<string, unknown> }>(
      `with driver as (
      select driver_id,rating from public.driver_profiles where user_id=$1
    ), trips as (
      select r.* from public.rides r join driver d using(driver_id) where r.departure_time>=now()-interval '30 days' and r.departure_time<=now()
    ), amounts as (
      select coalesce(sum(p.amount_cents) filter(where b.status in ('confirmed','in_progress','completed')),0) committed,
      coalesce(sum(c.amount_cents) filter(where c.status='collected'),0) collected,
      coalesce(sum(b.seats_reserved) filter(where b.status='completed'),0) transported
      from trips r join public.bookings b using(ride_id) join krow_pilot.booking_prices p using(booking_id)
      left join krow_pilot.cash c using(booking_id) where r.status<>'cancelled'
    ) select jsonb_build_object('periodDays',30,'currency','MXN','completed',count(*) filter(where t.status='completed'),
      'cancelled',count(*) filter(where t.status='cancelled'),'totalTrips',count(*),'transportedPassengers',a.transported,
      'committedCents',a.committed,'collectedCents',a.collected,'pendingCents',greatest(a.committed-a.collected,0),
      'rating',(select rating from driver)) metrics from trips t cross join amounts a group by a.transported,a.committed,a.collected`,
      [user.id],
    );
    if (!row)
      return {
        periodDays: 30,
        currency: 'MXN',
        completed: 0,
        cancelled: 0,
        totalTrips: 0,
        transportedPassengers: 0,
        committedCents: 0,
        collectedCents: 0,
        pendingCents: 0,
        rating: null,
      };
    return row.metrics;
  }

  private async profile(user: AuthenticatedUser): Promise<ProfileRow | null> {
    if (this.pilot?.enabled)
      return (
        (
          await this.pilot.query<ProfileRow>(
            'select uuid,full_name,profile_photo,rating,institutional_id,academic_program,academic_period from public.users where uuid=$1',
            [user.id],
          )
        )[0] ?? null
      );
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('users')
      .select(
        'uuid,full_name,profile_photo,rating,institutional_id,academic_program,academic_period',
      )
      .eq('uuid', user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private metadataString(user: AuthenticatedUser, key: string): string | null {
    const value = user.userMetadata[key];
    return typeof value === 'string' ? value : null;
  }
}
