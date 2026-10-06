import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { AdminGuard } from '../../auth/presentation/admin.guard.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { NotificationsService } from '../application/notifications.service.js';
import { RuntimeService } from '../application/runtime.service.js';
import { DeviceDto, IncidentActionDto, IncidentDto } from './runtime.dto.js';

@ApiTags('notifications-v2')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller({ path: '', version: '2' })
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly runtime: RuntimeService,
  ) {}
  @Post('devices') register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeviceDto,
  ) {
    return this.notifications.register(
      user.id,
      dto.deviceId,
      dto.platform,
      dto.token,
    );
  }
  @Delete('devices/:deviceId') revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.revoke(user.id, id);
  }
  @Get('notifications') inbox(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.inbox(user.id);
  }
  @Post('notifications/:intentId/acknowledge') acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('intentId', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.acknowledge(user.id, id);
  }
  @Post('rides/:rideId/incidents') incident(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: IncidentDto,
  ) {
    return this.notifications.incident(
      user.id,
      rideId,
      dto.incidentId,
      dto.severity,
    );
  }
  @Get('rides/:rideId/incidents') async incidents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    await this.runtime.snapshot(user.id, rideId);
    return this.runtime.db.query(
      'select incident_id as "incidentId",state,created_at as "createdAt",acknowledged_at as "acknowledgedAt" from krow_runtime.safety_incidents where ride_id=$1 and reporter_id=$2 order by created_at desc',
      [rideId, user.id],
    );
  }
  @Get('operations/incidents') @UseGuards(AdminGuard) queue() {
    return this.runtime.db.query(
      "select incident_id,ride_id,state,severity,created_at,assigned_to from krow_runtime.safety_incidents where state<>'resolved' order by created_at limit 100",
    );
  }
  @Post('operations/incidents/:incidentId') @UseGuards(AdminGuard) action(
    @CurrentUser() user: AuthenticatedUser,
    @Param('incidentId', ParseUUIDPipe) id: string,
    @Body() dto: IncidentActionDto,
  ) {
    return this.notifications.incidentAction(user.id, id, dto.state);
  }
}
