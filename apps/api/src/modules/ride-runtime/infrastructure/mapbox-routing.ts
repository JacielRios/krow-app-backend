import {
  Injectable,
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Coordinate, NavigationRoute } from '../domain/protocol.js';
import { RuntimeStreams } from './runtime-streams.js';

interface DirectionsResponse {
  code: string;
  routes?: Array<{
    geometry: NavigationRoute['geometry'];
    distance: number;
    duration: number;
    legs: Array<{ distance: number; duration: number; steps: unknown[] }>;
  }>;
}

@Injectable()
export class MapboxRouting {
  constructor(
    private readonly config: ConfigService,
    private readonly streams: RuntimeStreams,
  ) {}
  async calculate(
    origin: Coordinate | undefined,
    stops: Array<Coordinate & { stopId: string }>,
  ): Promise<NavigationRoute> {
    const points = origin ? [origin, ...stops] : stops;
    if (points.length < 2)
      throw new BadRequestException('Se requieren dos puntos para calcular');
    const token = this.config.getOrThrow<string>('MAPBOX_ACCESS_TOKEN');
    const redis = await this.streams.redis();
    if (await redis.exists('krow:mapbox:circuit'))
      throw new ServiceUnavailableException(
        'Enrutamiento temporalmente no disponible',
      );
    const route: NavigationRoute = {
      provider: 'mapbox',
      calculatedAt: new Date().toISOString(),
      geometry: { type: 'LineString', coordinates: [] },
      distanceMeters: 0,
      durationSeconds: 0,
      stopIds: stops.map((s) => s.stopId),
      legs: [],
      trafficAvailable: false,
    };
    // Split on actual stops, preserving order and a shared boundary between requests.
    for (let offset = 0; offset < points.length - 1; offset += 24) {
      const quotaKey = `krow:mapbox:quota:${Math.floor(Date.now() / 60000)}`;
      const count = await redis.incr(quotaKey);
      if (count === 1) await redis.expire(quotaKey, 120);
      if (count > Number(this.config.get('MAPBOX_REQUESTS_PER_MINUTE', 250)))
        throw new ServiceUnavailableException(
          'Capacidad de rutas temporalmente agotada',
        );
      const coordinates = points
        .slice(offset, offset + 25)
        .map((p) => `${p.lng},${p.lat}`)
        .join(';');
      const url = new URL(
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}`,
      );
      url.search = new URLSearchParams({
        access_token: token,
        geometries: 'geojson',
        overview: 'full',
        steps: 'true',
        language: 'es',
        annotations: 'distance,duration,congestion_numeric,maxspeed',
        alternatives: 'false',
      }).toString();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('provider_unavailable');
        const body = (await response.json()) as DirectionsResponse;
        const result = body.routes?.[0];
        if (
          body.code !== 'Ok' ||
          !result ||
          !Number.isFinite(result.distance) ||
          !Number.isFinite(result.duration) ||
          result.geometry?.type !== 'LineString' ||
          result.geometry.coordinates.length < 2 ||
          result.legs?.length !== Math.min(24, points.length - 1 - offset)
        )
          throw new Error('invalid_route');
        if (
          result.geometry.coordinates.some(
            (p) =>
              p.length < 2 ||
              !Number.isFinite(p[0]) ||
              !Number.isFinite(p[1]) ||
              Math.abs(p[0]) > 180 ||
              Math.abs(p[1]) > 90,
          )
        )
          throw new Error('invalid_geometry');
        route.geometry.coordinates.push(
          ...(offset
            ? result.geometry.coordinates.slice(1)
            : result.geometry.coordinates),
        );
        route.distanceMeters += result.distance;
        route.durationSeconds += result.duration;
        route.legs.push(
          ...result.legs.map((l) => ({
            distanceMeters: l.distance,
            durationSeconds: l.duration,
            steps: l.steps,
          })),
        );
      } catch {
        const failures = await redis.incr('krow:mapbox:failures');
        await redis.expire('krow:mapbox:failures', 60);
        if (failures >= 3)
          await redis.set('krow:mapbox:circuit', 'open', { EX: 30 });
        throw new BadGatewayException(
          'No se pudo actualizar la ruta; conserva la última disponible',
        );
      }
    }
    let distance = 0,
      duration = 0;
    route.stopProgress = stops.map((stop, index) => {
      const legIndex = origin ? index : index - 1;
      if (legIndex >= 0) {
        distance += route.legs[legIndex].distanceMeters;
        duration += route.legs[legIndex].durationSeconds;
      }
      return {
        stopId: stop.stopId,
        distanceMeters: distance,
        durationSeconds: duration,
      };
    });
    // driving-traffic can fall back to historical/free-flow data. Never assert live
    // coverage merely because the request used this profile.
    return route;
  }
}
