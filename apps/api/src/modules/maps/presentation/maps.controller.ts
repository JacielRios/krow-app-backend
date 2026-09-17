import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { GoogleMapsService } from '../infrastructure/google-maps.service.js';
import {
  AutocompleteQueryDto,
  PlaceDetailsQueryDto,
  ReverseGeocodeDto,
  RoutePreviewDto,
} from './maps.dto.js';
import { MapsRateLimitGuard } from './maps-rate-limit.guard.js';

@ApiTags('maps')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, MapsRateLimitGuard)
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: GoogleMapsService) {}
  @Get('places/autocomplete') autocomplete(
    @Query() query: AutocompleteQueryDto,
  ) {
    return this.maps.autocomplete(query.query, query.sessionToken);
  }
  @Get('places/:placeId') place(
    @Param('placeId') placeId: string,
    @Query() query: PlaceDetailsQueryDto,
  ) {
    return this.maps.placeDetails(placeId, query.sessionToken);
  }
  @Post('reverse-geocode') reverse(@Body() dto: ReverseGeocodeDto) {
    return this.maps.reverseGeocode(dto.point);
  }
  @Post('route-preview') route(@Body() dto: RoutePreviewDto) {
    return this.maps.routePreview(
      dto.origin,
      dto.destination,
      dto.departureTime,
    );
  }
}
