import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service.js';
import type { Database } from '../../../infrastructure/supabase/database.types.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { GoogleMapsService } from '../../maps/infrastructure/google-maps.service.js';
import { decodeGooglePolyline } from '../domain/polyline.js';
import { CAMPUS_ORIGIN } from '../domain/campus-origin.js';
import { PilotDatabase } from '../../pilot/pilot.database.js';
import { projectToPath } from '../domain/corridor-geometry.js';
import type {
  RoutePreviewRequestDto,
  SaveFavoriteRouteDto,
} from '../presentation/route.dto.js';

type RoutesClient = SupabaseClient<Database>;
type FavoriteRouteRow = Database['public']['Tables']['favorite_routes']['Row'];
type TransportStopRow = Database['public']['Tables']['transport_stops']['Row'];
type FavoriteJoinRow = FavoriteRouteRow & {
  corridor: { name: string } | { name: string }[] | null;
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
    @Optional() private readonly pilot?: PilotDatabase,
  ) {}

  async preview(user: AuthenticatedUser, dto: RoutePreviewRequestDto) {
    const computed = await this.computeWithCompatibleStops(user, dto);
    return {
      ...computed.preview,
      compatibleStops: computed.compatibleStops,
      corridorId: computed.corridorId ?? null,
      corridorName: computed.corridorName ?? null,
    };
  }

  async computeWithCompatibleStops(
    user: AuthenticatedUser,
    dto: RoutePreviewRequestDto,
  ) {
    if (dto.corridorId) return this.computeCorridor(user, dto);
    const computed = await this.compute(dto);
    const { data, error } = await this.client(user).rpc(
      'find_compatible_transport_stops',
      { p_route_geojson: computed.routeGeoJson, p_corridor_m: 500 },
    );
    if (error) throw new BadRequestException(error.message);
    return {
      ...computed,
      corridorId: null,
      corridorName: null,
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

  async corridors(user: AuthenticatedUser) {
    const client = this.client(user);
    const [corridors, stops] = await Promise.all([
      client
        .from('transport_corridors')
        .select('*')
        .eq('active', true)
        .order('display_order'),
      client
        .from('transport_stops')
        .select('*')
        .eq('active', true)
        .order('corridor_order'),
    ]);
    if (corridors.error || stops.error)
      throw new BadRequestException(
        'No se pudo cargar el catálogo de avenidas',
      );
    return (corridors.data ?? []).map((corridor) => ({
      corridorId: corridor.corridor_id,
      name: corridor.name,
      code: corridor.code,
      direction: corridor.direction,
      stops: (stops.data ?? [])
        .filter((stop) => stop.corridor_id === corridor.corridor_id)
        .map((stop) => ({
          stopId: stop.stop_id,
          externalId: stop.external_id,
          name: stop.name,
          address: stop.address,
          municipality: stop.municipality,
          location: { lat: Number(stop.latitude), lng: Number(stop.longitude) },
          direction: stop.direction ?? corridor.direction,
          active: stop.active,
          stopType: stop.stop_type,
          source: stop.source,
          stopOrder: Number(stop.corridor_order),
        })),
    }));
  }

  private async computeCorridor(
    user: AuthenticatedUser,
    dto: RoutePreviewRequestDto,
  ) {
    const corridor = (await this.corridors(user)).find(
      (item) => item.corridorId === dto.corridorId,
    );
    if (!corridor?.stops.length)
      throw new BadRequestException('La avenida no tiene paradas activas');
    const path = corridor.stops.map((stop) => stop.location);
    const endpoint = projectToPath(dto.destination, path);
    // Include the nearest catalog stop, but never silently extend to the whole avenue.
    const nearest = corridor.stops.reduce(
      (best, stop) =>
        projectToPath(stop.location, path).progress <= endpoint.progress + 500
          ? stop
          : best,
      corridor.stops[0],
    );
    const viable = corridor.stops.filter(
      (stop) => stop.stopOrder <= nearest.stopOrder,
    );
    const chosen = dto.transportStopIds;
    if (
      chosen &&
      (!chosen.length ||
        new Set(chosen).size !== chosen.length ||
        chosen.some((id) => !viable.some((stop) => stop.stopId === id)))
    ) {
      throw new BadRequestException(
        'Selecciona paradas activas de la avenida que estén dentro del trayecto',
      );
    }
    // Catalog references guide the selected avenue. Passing a reference never
    // enables it for passengers; only explicit selected IDs are persisted.
    const waypoints = viable;
    if (waypoints.length > 23)
      throw new BadRequestException(
        'Selecciona como máximo 23 paradas para este viaje',
      );
    const preview = await this.maps.routePreview(
      dto.origin,
      dto.destination,
      dto.departureTime,
      waypoints.map((stop) => stop.location),
    );
    if (!preview)
      throw new BadRequestException(
        'Google Maps no encontró una ruta para la avenida seleccionada',
      );
    const routeGeoJson = decodeGooglePolyline(preview.encodedPolyline);
    const routePath = routeGeoJson.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
    return {
      preview,
      routeGeoJson,
      corridorId: corridor.corridorId,
      corridorName: corridor.name,
      compatibleStops: viable.map((stop) => {
        const projection = projectToPath(stop.location, routePath);
        return {
          ...stop,
          distanceFromRouteMeters: Math.round(projection.distance),
          routeFraction:
            projection.total > 0 ? projection.progress / projection.total : 0,
        };
      }),
    };
  }

  async publicationStops(
    user: AuthenticatedUser,
    corridorId: string,
    transportStopIds?: string[],
  ) {
    if (!corridorId || !transportStopIds?.length)
      throw new BadRequestException(
        'Selecciona una avenida y al menos una parada de descenso',
      );
    const corridor = (await this.corridors(user)).find(
      (item) => item.corridorId === corridorId,
    );
    if (
      !corridor ||
      new Set(transportStopIds).size !== transportStopIds.length ||
      transportStopIds.some(
        (id) => !corridor.stops.some((stop) => stop.stopId === id),
      )
    ) {
      throw new BadRequestException(
        'Las paradas seleccionadas no pertenecen a una avenida activa',
      );
    }
    const { data: campus, error } = await this.client(user)
      .from('transport_stops')
      .select('stop_id')
      .eq('external_id', 'krow-initial-stop-2')
      .eq('active', true)
      .maybeSingle();
    if (error || !campus)
      throw new BadRequestException(
        'La parada de salida del ITNL no está disponible',
      );
    return [
      campus.stop_id,
      ...corridor.stops
        .filter((stop) => transportStopIds.includes(stop.stopId))
        .map((stop) => stop.stopId),
    ];
  }

  async listFavorites(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('favorite_routes')
      .select(
        `*, corridor:transport_corridors(name), favorite_route_stops(
          stop_order, route_fraction,
          transport_stop:transport_stops(
            stop_id, external_id, name, address, municipality,
            latitude, longitude, active, stop_type, corridor_id, direction
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
    if (this.pilot?.enabled) {
      await this.pilot.routeRpc(user.id, 'delete_favorite_route', [routeId]);
      return { success: true };
    }
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
    const selectedStops = await this.publicationStops(
      user,
      dto.corridorId,
      dto.transportStopIds,
    );
    const computed = await this.computeWithCompatibleStops(user, {
      origin: CAMPUS_ORIGIN,
      destination: dto.destination,
      corridorId: dto.corridorId,
      transportStopIds: dto.transportStopIds,
    });
    const payload = {
      route_id: routeId,
      name: dto.name,
      corridor_id: dto.corridorId,
      origin_place_id: CAMPUS_ORIGIN.placeId,
      origin_address: CAMPUS_ORIGIN.address,
      origin_lat: CAMPUS_ORIGIN.lat,
      origin_lng: CAMPUS_ORIGIN.lng,
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
      transport_stop_ids: selectedStops,
      route_geojson: computed.routeGeoJson,
    };
    if (this.pilot?.enabled)
      return {
        routeId: await this.pilot.routeRpc(user.id, 'upsert_favorite_route', [
          payload,
        ]),
      };
    const { data, error } = await this.client(user).rpc(
      'upsert_favorite_route',
      { p_payload: payload },
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
        return stop &&
          (!route.corridor_id || stop.corridor_id === route.corridor_id)
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
      corridorId: route.corridor_id,
      corridorName:
        (Array.isArray(route.corridor) ? route.corridor[0] : route.corridor)
          ?.name ?? null,
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
