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
import { SaveTransportStopDto } from './transport-stop.dto.js';
import { TransportStopsService } from './transport-stops.service.js';

@ApiTags('admin/transport-stops')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard)
@Controller('admin/transport-stops')
export class TransportStopsController {
  constructor(private readonly stops: TransportStopsService) {}

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
