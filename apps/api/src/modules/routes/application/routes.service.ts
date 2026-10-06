import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { Database } from '../../../infrastructure/supabase/database.types.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { GoogleMapsService } from '../../maps/infrastructure/google-maps.service.js';
import { decodeGooglePolyline } from '../domain/polyline.js';
import type {
  RoutePreviewRequestDto,
  SaveFavoriteRouteDto,
} from '../presentation/route.dto.js';

type RoutesClient = SupabaseClient<Database>;
type FavoriteRouteRow = Database['public']['Tables']['favorite_routes']['Row'];
type TransportStopRow = Database['public']['Tables']['transport_stops']['Row'];
type FavoriteJoinRow = FavoriteRouteRow & {
  favorite_route_stops: Array<{
    stop_order: number;
    route_fraction: number;
    transport_stop: TransportStopRow | TransportStopRow[] | null;
  }>;
};

@Injectable()
export class RoutesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly maps: GoogleMapsService,
  ) {}

  async preview(user: AuthenticatedUser, dto: RoutePreviewRequestDto) {
    const computed = await this.computeWithCompatibleStops(user, dto);
    return {
      ...computed.preview,
      compatibleStops: computed.compatibleStops,
    };
  }

  async computeWithCompatibleStops(
    user: AuthenticatedUser,
    dto: RoutePreviewRequestDto,
  ) {
    const computed = await this.compute(dto);
    const { data, error } = await this.client(user).rpc(
      'find_compatible_transport_stops',
      { p_route_geojson: computed.routeGeoJson, p_corridor_m: 500 },
    );
    if (error) throw new BadRequestException(error.message);
    return {
      ...computed,
      compatibleStops: (data ?? []).map((stop) => ({
        stopId: stop.stop_id,
        externalId: stop.external_id,
        name: stop.name,
        address: stop.address,
        municipality: stop.municipality,
        location: { lat: Number(stop.lat), lng: Number(stop.lng) },
        distanceFromRouteMeters: Math.round(Number(stop.distance_from_route_m)),
        routeFraction: Number(stop.route_fraction),
      })),
    };
  }

  async listFavorites(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('favorite_routes')
      .select(
        `*, favorite_route_stops(
          stop_order, route_fraction,
          transport_stop:transport_stops(
            stop_id, external_id, name, address, municipality,
            latitude, longitude, active
          )
        )`,
      )
      .order('updated_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as FavoriteJoinRow[];
    return rows.map((route) => this.mapFavorite(route));
  }

  async findFavorite(user: AuthenticatedUser, routeId: string) {
    const favorites = await this.listFavorites(user);
    const favorite = favorites.find((route) => route.routeId === routeId);
    if (!favorite) throw new NotFoundException('Ruta favorita no encontrada');
    return favorite;
  }

  createFavorite(user: AuthenticatedUser, dto: SaveFavoriteRouteDto) {
    return this.saveFavorite(user, dto);
  }

  updateFavorite(
    user: AuthenticatedUser,
    routeId: string,
    dto: SaveFavoriteRouteDto,
  ) {
    return this.saveFavorite(user, dto, routeId);
  }

  async deleteFavorite(user: AuthenticatedUser, routeId: string) {
    const { error } = await this.client(user).rpc('delete_favorite_route', {
      p_route_id: routeId,
    });
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  async compute(dto: RoutePreviewRequestDto) {
    const preview = await this.maps.routePreview(
      dto.origin,
      dto.destination,
      dto.departureTime,
    );
    if (!preview) {
      throw new BadRequestException(
        'Google Maps no encontró una ruta conducible',
      );
    }
    return {
      preview,
      routeGeoJson: decodeGooglePolyline(preview.encodedPolyline),
    };
  }

  private async saveFavorite(
    user: AuthenticatedUser,
    dto: SaveFavoriteRouteDto,
    routeId?: string,
  ) {
    const computed = await this.computeWithCompatibleStops(user, {
      origin: dto.origin,
      destination: dto.destination,
    });
    const { data, error } = await this.client(user).rpc(
      'upsert_favorite_route',
      {
        p_payload: {
          route_id: routeId,
          name: dto.name,
          origin_place_id: dto.origin.placeId,
          origin_address: dto.origin.address,
          origin_lat: dto.origin.lat,
          origin_lng: dto.origin.lng,
          destination_place_id: dto.destination.placeId,
          destination_address: dto.destination.address,
          destination_lat: dto.destination.lat,
          destination_lng: dto.destination.lng,
          default_vehicle_id: dto.defaultVehicleId,
          default_available_seats: dto.defaultAvailableSeats,
          default_price_per_seat:
            dto.defaultPricePerSeatCents == null
              ? undefined
              : dto.defaultPricePerSeatCents / 100,
          transport_stop_ids: computed.compatibleStops.map(
            (stop) => stop.stopId,
          ),
          route_geojson: computed.routeGeoJson,
        },
      },
    );
    if (error) throw new BadRequestException(error.message);
    return { routeId: data };
  }

  private mapFavorite(route: FavoriteJoinRow) {
    const stops = (route.favorite_route_stops ?? [])
      .map((item) => {
        const stop = Array.isArray(item.transport_stop)
          ? item.transport_stop[0]
          : item.transport_stop;
        return stop
          ? {
              stopId: stop.stop_id,
              externalId: stop.external_id,
              name: stop.name,
              address: stop.address,
              municipality: stop.municipality,
              location: {
                lat: Number(stop.latitude),
                lng: Number(stop.longitude),
              },
              active: Boolean(stop.active),
              stopOrder: Number(item.stop_order),
              routeFraction: Number(item.route_fraction),
            }
          : null;
      })
      .filter((stop) => stop !== null)
      .sort((a, b) => a.stopOrder - b.stopOrder);
    return {
      routeId: route.route_id,
      name: route.name,
      origin: {
        placeId: route.origin_place_id,
        address: route.origin_address,
        lat: Number(route.origin_lat),
        lng: Number(route.origin_lng),
      },
      destination: {
        placeId: route.destination_place_id,
        address: route.destination_address,
        lat: Number(route.destination_lat),
        lng: Number(route.destination_lng),
      },
      defaults: {
        vehicleId: route.default_vehicle_id,
        availableSeats: route.default_available_seats,
        pricePerSeatCents:
          route.default_price_per_seat == null
            ? null
            : Math.round(Number(route.default_price_per_seat) * 100),
      },
      stops,
      hasStaleStops: stops.some((stop) => !stop.active),
      createdAt: route.created_at,
      updatedAt: route.updated_at,
    };
  }

  private client(user: AuthenticatedUser): RoutesClient {
    return this.supabase.forUser(user.accessToken);
  }
}
