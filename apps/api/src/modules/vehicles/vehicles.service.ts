import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';

@Injectable()
export class VehiclesService {
  constructor(private readonly supabase: SupabaseService) {}
  async list(user: AuthenticatedUser) {
    const client = this.supabase.forUser(user.accessToken);
    const { data: driver, error: driverError } = await client
      .from('driver_profiles')
      .select('driver_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (driverError) throw driverError;
    if (!driver)
      throw new NotFoundException('Perfil de conductor no encontrado');

    const { data, error } = await client
      .from('vehicles')
      .select(
        'vehicle_id, brand, model, car_year, license_plate, car_color, capacity',
      )
      .eq('driver_id', driver.driver_id)
      .eq('is_active', true);
    if (error) throw error;
    return data ?? [];
  }
}
