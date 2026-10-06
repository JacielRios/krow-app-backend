import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import type { SaveTransportStopDto } from './transport-stop.dto.js';

@Injectable()
export class TransportStopsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('transport_stops')
      .select(
        'stop_id, external_id, name, address, municipality, latitude, longitude, stop_type, active, created_at, updated_at',
      )
      .order('stop_type')
      .order('name');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((stop) => ({
      stopId: stop.stop_id,
      externalId: stop.external_id,
      name: stop.name,
      address: stop.address,
      municipality: stop.municipality,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      stopType: stop.stop_type,
      active: stop.active,
      createdAt: stop.created_at,
      updatedAt: stop.updated_at,
    }));
  }

  async create(user: AuthenticatedUser, dto: SaveTransportStopDto) {
    return this.save(user, dto);
  }

  async update(
    user: AuthenticatedUser,
    stopId: string,
    dto: SaveTransportStopDto,
  ) {
    return this.save(user, dto, stopId);
  }

  private async save(
    user: AuthenticatedUser,
    dto: SaveTransportStopDto,
    stopId?: string,
  ) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .rpc('admin_upsert_transport_stop', {
        p_payload: {
          stop_id: stopId,
          external_id: dto.externalId.trim(),
          name: dto.name.trim(),
          address: dto.address?.trim(),
          municipality: dto.municipality?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          stop_type: dto.stopType,
          active: dto.active,
        },
      });
    if (error) throw new BadRequestException(error.message);
    return { stopId: data };
  }
}
