import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { RoutesService } from '../application/routes.service.js';
import { MapsRateLimitGuard } from '../../maps/presentation/maps-rate-limit.guard.js';
import { RoutePreviewRequestDto, SaveFavoriteRouteDto } from './route.dto.js';

@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, MapsRateLimitGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post('preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RoutePreviewRequestDto,
  ) {
    return this.routes.preview(user, dto);
  }

  @Get('favorites')
  favorites(@CurrentUser() user: AuthenticatedUser) {
    return this.routes.listFavorites(user);
  }

  @Post('favorites')
  createFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveFavoriteRouteDto,
  ) {
    return this.routes.createFavorite(user, dto);
  }

  @Get('favorites/:routeId')
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('routeId', ParseUUIDPipe) routeId: string,
  ) {
    return this.routes.findFavorite(user, routeId);
  }

  @Patch('favorites/:routeId')
  updateFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @Body() dto: SaveFavoriteRouteDto,
  ) {
    return this.routes.updateFavorite(user, routeId, dto);
  }

  @Delete('favorites/:routeId')
  deleteFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('routeId', ParseUUIDPipe) routeId: string,
  ) {
    return this.routes.deleteFavorite(user, routeId);
  }
}
