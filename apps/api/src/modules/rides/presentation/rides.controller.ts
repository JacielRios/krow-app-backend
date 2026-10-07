import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { MapsRateLimitGuard } from '../../maps/presentation/maps-rate-limit.guard.js';
import { RidesService } from '../application/rides.service.js';
import { RideViewsService } from '../application/ride-views.service.js';
import {
  CreateRideDto,
  DriverRidesQueryDto,
  RecentRidesQueryDto,
  RideReasonDto,
  SearchRidesDto,
  RideStopOptionsDto,
  PassengerStopCandidatesDto,
  UpdateRideDto,
} from './ride.dto.js';

@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly views: RideViewsService,
  ) {}
  @UseGuards(MapsRateLimitGuard)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRideDto) {
    return this.rides.create(user, dto);
  }
  @UseGuards(MapsRateLimitGuard)
  @Post('search')
  search(@CurrentUser() user: AuthenticatedUser, @Body() dto: SearchRidesDto) {
    return this.rides.search(user, dto);
  }
  @UseGuards(MapsRateLimitGuard)
  @Post('stops/candidates')
  stopCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PassengerStopCandidatesDto,
  ) {
    return this.rides.stopCandidates(user, dto);
  }
  @Get('mine/recent') recent(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecentRidesQueryDto,
  ) {
    return this.views.recent(user, query.limit, query.context);
  }
  @Get('mine/active') active(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecentRidesQueryDto,
  ) {
    return this.views.active(user, query.context);
  }
  @Get('mine') mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DriverRidesQueryDto,
  ) {
    return this.rides.mine(user, query);
  }
  @UseGuards(MapsRateLimitGuard)
  @Post(':rideId/stop-options')
  stopOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RideStopOptionsDto,
  ) {
    return this.rides.stopOptions(user, rideId, dto);
  }
  @Get(':rideId/scheduled-view') scheduledView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.views.scheduled(user, rideId);
  }
  @Get(':rideId/active-view') activeView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.views.activeData(user, rideId);
  }
  @Get(':rideId') findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.rides.findOne(user, rideId);
  }
  @UseGuards(MapsRateLimitGuard)
  @Put(':rideId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: UpdateRideDto,
  ) {
    return this.rides.update(user, rideId, dto);
  }
  @Post(':rideId/start') start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.rides.start(user, rideId);
  }
  @Post(':rideId/cancel') cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto?: RideReasonDto,
  ) {
    return this.rides.cancel(user, rideId, dto?.reason);
  }
  @Post(':rideId/complete') complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.rides.complete(user, rideId);
  }
  @Post(':rideId/stops/:bookingId/complete') completeStop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.rides.completeStop(user, rideId, bookingId);
  }
}
