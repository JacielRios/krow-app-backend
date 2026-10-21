import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';
import { TransportStopsService } from './transport-stops.service.js';
import type { SuggestTransportStopDto } from './transport-stop.dto.js';
import { suggestStop } from './stop-suggestions.js';

@Injectable()
export class StopSuggestionsService {
  constructor(
    private readonly stops: TransportStopsService,
    private readonly maps: GoogleMapsService,
  ) {}
  async suggest(user: AuthenticatedUser, dto: SuggestTransportStopDto) {
    const [catalog, corridors, geocode] = await Promise.all([
      this.stops.list(user),
      this.stops.corridors(user),
      this.maps
        .reverseGeocode({ lat: dto.latitude, lng: dto.longitude })
        .then((value) => ({ value, failed: false }))
        .catch(() => ({ value: null, failed: true })),
    ]);
    return suggestStop(dto, geocode.value, corridors, catalog, geocode.failed);
  }
}
