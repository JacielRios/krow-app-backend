import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import type { UpsertProfileDto } from './profile.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async me(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('users')
      .select('uuid, full_name, profile_photo, rating')
      .eq('uuid', user.id)
      .maybeSingle();
    if (error) throw error;
    const { data: driver, error: driverError } = await this.supabase
      .forUser(user.accessToken)
      .from('driver_profiles')
      .select('driver_id, status, rating')
      .eq('user_id', user.id)
      .maybeSingle();
    if (driverError) throw driverError;

    return {
      userId: data?.uuid ?? user.id,
      email: user.email,
      fullName: data?.full_name ?? this.metadataString(user, 'full_name'),
      profilePhoto: data?.profile_photo ?? null,
      rating: data?.rating ?? null,
      role: driver ? 'conductor' : 'pasajero',
      canPublishRides: driver?.status === 'approved',
      driverProfile: driver
        ? {
            driverId: driver.driver_id,
            status: driver.status,
            rating: driver.rating,
          }
        : null,
    };
  }

  async upsertProfile(user: AuthenticatedUser, profile: UpsertProfileDto) {
    const { error } = await this.supabase
      .forUser(user.accessToken)
      .from('users')
      .upsert(
        {
          uuid: user.id,
          email_address: user.email,
          is_active: true,
          full_name: profile.fullName,
          institutional_id: profile.institutionalId,
          academic_program: profile.academicProgram,
          academic_period: profile.academicPeriod ?? null,
        },
        { onConflict: 'uuid' },
      );
    if (error) throw error;
    return { success: true };
  }

  private metadataString(user: AuthenticatedUser, key: string): string | null {
    const value = user.userMetadata[key];
    return typeof value === 'string' ? value : null;
  }
}
