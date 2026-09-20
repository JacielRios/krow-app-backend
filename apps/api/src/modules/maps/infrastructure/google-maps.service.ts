/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Google REST payloads are validated by status and mapped at this boundary. */
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Params = Record<string, string | number | undefined>;
export interface GoogleRoutePreview {
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
  bounds: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  provider: 'google';
  calculatedAt: string;
}

@Injectable()
export class GoogleMapsService {
  private readonly apiKey?: string;
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GOOGLE_MAPS_API_KEY');
  }

  async autocomplete(query: string, sessionToken?: string) {
    const json = await this.get(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      {
        input: query,
        sessiontoken: sessionToken,
        language: 'es',
        components: 'country:mx',
      },
    );
    if (json.status === 'ZERO_RESULTS') return [];
    this.assertOk(json);
    return (json.predictions ?? []).map((item: any) => ({
      placeId: item.place_id,
      description: item.description,
      mainText: item.structured_formatting?.main_text ?? item.description,
      secondaryText: item.structured_formatting?.secondary_text ?? '',
    }));
  }

  async placeDetails(placeId: string, sessionToken?: string) {
    const json = await this.get(
      'https://maps.googleapis.com/maps/api/place/details/json',
      {
        place_id: placeId,
        sessiontoken: sessionToken,
        fields: 'place_id,formatted_address,geometry/location',
        language: 'es',
      },
    );
    this.assertOk(json);
    return {
      placeId: json.result.place_id,
      formattedAddress: json.result.formatted_address,
      location: json.result.geometry.location,
    };
  }

  async reverseGeocode(point: { lat: number; lng: number }) {
    const json = await this.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        latlng: `${point.lat},${point.lng}`,
        language: 'es',
      },
    );
    if (json.status === 'ZERO_RESULTS') return null;
    this.assertOk(json);
    return {
      formattedAddress: json.results[0].formatted_address,
      placeId: json.results[0].place_id ?? null,
    };
  }

  async routePreview(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    departureTime?: string,
  ): Promise<GoogleRoutePreview | null> {
    const json = await this.get(
      'https://maps.googleapis.com/maps/api/directions/json',
      {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        mode: 'driving',
        language: 'es',
        departure_time: departureTime
          ? Math.floor(new Date(departureTime).getTime() / 1000)
          : undefined,
      },
    );
    if (json.status === 'ZERO_RESULTS') return null;
    this.assertOk(json);
    const route = json.routes[0];
    return {
      encodedPolyline: route.overview_polyline.points,
      distanceMeters: (route.legs ?? []).reduce(
        (sum: number, leg: any) => sum + (leg.distance?.value ?? 0),
        0,
      ),
      durationSeconds: (route.legs ?? []).reduce(
        (sum: number, leg: any) => sum + (leg.duration?.value ?? 0),
        0,
      ),
      bounds: route.bounds,
      provider: 'google',
      calculatedAt: new Date().toISOString(),
    };
  }

  private async get(base: string, params: Params): Promise<any> {
    if (!this.apiKey)
      throw new ServiceUnavailableException(
        'Google Maps no está configurado en el backend',
      );
    const search = new URLSearchParams({ key: this.apiKey });
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) search.set(key, String(value));
    });
    const url = `${base}?${search.toString()}`;
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = await response.json();
        this.cache.set(url, { value, expiresAt: Date.now() + 60_000 });
        return value;
      } catch (error) {
        lastError = error;
      }
    }
    throw new BadGatewayException(
      lastError instanceof Error
        ? lastError.message
        : 'Google Maps no respondió',
    );
  }

  private assertOk(json: any) {
    if (json.status !== 'OK')
      throw new BadGatewayException(
        json.error_message ?? `Google Maps: ${json.status}`,
      );
  }
}
