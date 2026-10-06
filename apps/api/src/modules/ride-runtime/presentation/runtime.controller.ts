import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { RuntimeService } from '../application/runtime.service.js';
import { TrackingService } from '../application/tracking.service.js';
import { MapboxRouting } from '../infrastructure/mapbox-routing.js';
import { progressToStop, shouldReroute } from '../domain/geospatial.js';
import {
  LocationBatchDto,
  LocationSessionDto,
  ReplayDto,
  RouteUpdateDto,
  RuntimeBookingDto,
  RuntimeCommandDto,
} from './runtime.dto.js';

@ApiTags('ride-runtime-v2')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller({ path: 'rides', version: '2' })
export class RuntimeController {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly tracking: TrackingService,
    private readonly maps: MapboxRouting,
  ) {}
  @Post(':rideId/session') enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.runtime.enroll(user.id, rideId);
  }
  @Get(':rideId/session') async snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    const snapshot = await this.runtime.snapshot(user.id, rideId);
    if (['completed', 'cancelled', 'interrupted'].includes(snapshot.state))
      return snapshot;
    if (
      snapshot.role === 'passenger' &&
      !snapshot.bookings.some((b) =>
        ['confirmed', 'in_progress'].includes(b.status),
      )
    )
      return snapshot;
    const position = await this.tracking.latest(rideId);
    snapshot.position = position;
    snapshot.tracking = position
      ? Date.now() - Date.parse(position.capturedAt) < 30000
        ? 'live'
        : 'stale'
      : 'unavailable';
    if (position && snapshot.route && snapshot.tracking === 'live') {
      const booking = snapshot.bookings.find((b) =>
        ['confirmed', 'in_progress'].includes(b.status),
      );
      const target =
        snapshot.role === 'driver'
          ? snapshot.nextStopId
          : booking?.status === 'confirmed'
            ? booking.pickupStopId
            : booking?.dropoffStopId;
      const progress = target
        ? progressToStop(position, snapshot.route, target)
        : null;
      if (
        progress &&
        position.accuracyMeters <= 50 &&
        progress.offRouteMeters < Math.max(30, position.accuracyMeters * 2)
      ) {
        snapshot.remainingMeters = progress.remainingMeters;
        snapshot.etaSeconds = progress.etaSeconds;
      }
    }
    return snapshot;
  }
  @Post(':rideId/bookings') booking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RuntimeBookingDto,
  ) {
    return this.runtime.requestBooking(user.id, rideId, dto);
  }
  @Post(':rideId/commands') command(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RuntimeCommandDto,
  ) {
    return this.runtime.command(user.id, rideId, dto);
  }
  @Post(':rideId/location-sessions') locationSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: LocationSessionDto,
  ) {
    return this.runtime.openLocationSession(user.id, rideId, dto.deviceId);
  }
  @Delete(':rideId/location-sessions/:sessionId') closeLocationSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.runtime.closeLocationSession(user.id, rideId, sessionId);
  }
  @Post(':rideId/locations') locations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: LocationBatchDto,
  ) {
    return this.tracking.ingest(user.id, rideId, dto.samples);
  }
  @Get(':rideId/events') events(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Query() dto: ReplayDto,
  ) {
    return this.runtime.replayEvents(user.id, rideId, dto.after);
  }
  @Post(':rideId/route') async route(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RouteUpdateDto,
  ) {
    await this.runtime.authorize(user.id, rideId, true);
    const snapshot = await this.runtime.snapshot(user.id, rideId);
    const position = await this.tracking.latest(rideId);
    const origin =
      position && Date.now() - Date.parse(position.capturedAt) < 30000
        ? position
        : undefined;
    if (snapshot.state === 'in_progress' && !origin)
      throw new ConflictException(
        'Se requiere una ubicación reciente para recalcular',
      );
    const stops = snapshot.stops.filter(
      (s) => !['departed', 'skipped'].includes(s.state),
    );
    const route = await this.maps.calculate(origin, stops);
    if (
      dto.reason === 'traffic' &&
      snapshot.route &&
      !shouldReroute(
        snapshot.route.durationSeconds,
        route.durationSeconds,
        'traffic',
      )
    )
      return { changed: false, version: snapshot.version };
    return this.runtime.saveRoute(
      user.id,
      rideId,
      dto.expectedVersion,
      route,
      dto.reason,
    );
  }
}
