import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { AdminGuard } from '../auth/presentation/admin.guard.js';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import {
  SaveTransportStopDto,
  SuggestTransportStopDto,
} from './transport-stop.dto.js';
import { TransportStopsService } from './transport-stops.service.js';
import { StopSuggestionsService } from './stop-suggestions.service.js';
import { MapsRateLimitGuard } from '../maps/presentation/maps-rate-limit.guard.js';

@ApiTags('admin/transport-stops')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard)
@Controller('admin/transport-stops')
export class TransportStopsController {
  constructor(
    private readonly stops: TransportStopsService,
    private readonly suggestions: StopSuggestionsService,
  ) {}

  @Post('suggest')
  @UseGuards(MapsRateLimitGuard)
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SuggestTransportStopDto,
  ) {
    return this.suggestions.suggest(user, dto);
  }

  @Get('corridors')
  corridors(@CurrentUser() user: AuthenticatedUser) {
    return this.stops.corridors(user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.stops.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveTransportStopDto,
  ) {
    return this.stops.create(user, dto);
  }

  @Patch(':stopId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: SaveTransportStopDto,
  ) {
    return this.stops.update(user, stopId, dto);
  }
}
