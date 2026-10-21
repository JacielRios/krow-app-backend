import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import type { SaveTransportStopDto } from './transport-stop.dto.js';

@Injectable()
export class TransportStopsService {
  constructor(private readonly supabase: SupabaseService) {}

  async corridors(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('transport_corridors')
      .select('corridor_id,code,name,direction,active')
      .order('display_order');
    if (error) throw new BadRequestException('No pudimos cargar las avenidas');
    return (data ?? []).map((row) => ({
      corridorId: row.corridor_id,
      code: row.code,
      name: row.name,
      direction: row.direction,
      active: row.active,
    }));
  }

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .from('transport_stops')
      .select(
        'stop_id, external_id, name, address, municipality, latitude, longitude, stop_type, active, created_at, updated_at, corridor_id, corridor_order, direction',
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
      corridorId: stop.corridor_id,
      stopOrder: stop.corridor_order,
      direction: stop.direction,
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
          insert_at_order: dto.insertAtOrder ?? false,
          expected_catalog_version: dto.expectedCatalogVersion,
          ...(dto.corridorId !== undefined
            ? { corridor_id: dto.corridorId }
            : {}),
          ...(dto.stopOrder !== undefined
            ? { corridor_order: dto.stopOrder }
            : {}),
          ...(dto.direction !== undefined
            ? { direction: dto.direction?.trim() || null }
            : {}),
        },
      });
    if (error) throw new BadRequestException(error.message);
    return { stopId: data };
  }
}
