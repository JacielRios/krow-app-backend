import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { PilotService } from './pilot.service.js';
import { PilotNotifications } from './pilot.notifications.js';
import { PilotRateLimitGuard } from './pilot-rate-limit.guard.js';

class ActivityQuery {
  @IsIn(['driver', 'passenger']) context: 'driver' | 'passenger' = 'passenger';
  @IsIn(['upcoming', 'active', 'history']) group:
    | 'upcoming'
    | 'active'
    | 'history' = 'upcoming';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 30;
}
class SessionDto {
  @IsUUID() deviceId!: string;
}
class DeviceDto {
  @IsUUID() deviceId!: string;
  @IsString() @MinLength(20) @MaxLength(4096) token!: string;
}
class AttendDto {
  @IsIn(['board', 'dropoff', 'no-show']) action!:
    | 'board'
    | 'dropoff'
    | 'no-show';
}
class MessageDto {
  @IsUUID() clientId!: string;
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
class MessagesQuery {
  @IsOptional() @IsString() @MaxLength(256) cursor?: string;
}
class ReviewDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment = '';
}
class SampleDto {
  @IsInt() @Min(0) seq!: number;
  @IsDateString() capturedAt!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsNumber() @Min(0) @Max(200) accuracy!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(80) speed?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) heading?: number;
}
class UploadDto {
  @IsUUID() sessionId!: string;
  @IsString() @MinLength(40) @MaxLength(64) uploadToken!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SampleDto)
  samples!: SampleDto[];
}
class CloseUploadDto {
  @IsUUID() sessionId!: string;
  @IsString() @MinLength(40) @MaxLength(64) uploadToken!: string;
}

@Controller()
@UseGuards(SupabaseAuthGuard, PilotRateLimitGuard)
export class PilotController {
  constructor(
    private readonly pilot: PilotService,
    private readonly notifications: PilotNotifications,
  ) {}
  @Post('me/closure') closure(@CurrentUser() u: AuthenticatedUser) {
    return this.pilot.requestClosure(u);
  }
  @Post('devices') device(
    @CurrentUser() u: AuthenticatedUser,
    @Body() dto: DeviceDto,
  ) {
    return this.notifications.register(u.id, dto.deviceId, dto.token);
  }
  @Delete('devices/:deviceId') removeDevice(
    @CurrentUser() u: AuthenticatedUser,
    @Param('deviceId', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.unregister(u.id, id);
  }
  @Get('activity') activity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ActivityQuery,
  ) {
    return this.pilot.activity(user, q.context, q.group, q.offset, q.limit);
  }
  @Post('rides/:rideId/stops/:bookingId/attend') attend(
    @CurrentUser() u: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) r: string,
    @Param('bookingId', ParseUUIDPipe) b: string,
    @Body() dto: AttendDto,
  ) {
    return this.pilot.attend(u, r, b, dto.action);
  }
  @Get('rides/:rideId/history') history(
    @CurrentUser() u: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) r: string,
  ) {
    return this.pilot.history(u, r);
  }
  @Get('rides/:rideId/tracking') snapshot(
    @CurrentUser() u: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) r: string,
  ) {
    return this.pilot.snapshot(u, r);
  }
  @Post('rides/:rideId/tracking/sessions') session(
    @CurrentUser() u: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) r: string,
    @Body() dto: SessionDto,
  ) {
    return this.pilot.openSession(u, r, dto.deviceId);
  }
  @Delete('rides/:rideId/tracking/sessions') close(
    @CurrentUser() u: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) r: string,
  ) {
    return this.pilot.closeSession(u, r);
  }
  @Get('bookings/:bookingId/messages') messages(
    @CurrentUser() u: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) b: string,
    @Query() q: MessagesQuery,
  ) {
    return this.pilot.messages(u, b, q.cursor);
  }
  @Post('bookings/:bookingId/messages') send(
    @CurrentUser() u: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) b: string,
    @Body() dto: MessageDto,
  ) {
    return this.pilot.send(u, b, dto.clientId, dto.body);
  }
  @Get('bookings/:bookingId/cash') cash(
    @CurrentUser() u: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) b: string,
  ) {
    return this.pilot.cash(u, b);
  }
  @Post('bookings/:bookingId/cash/collect') collect(
    @CurrentUser() u: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) b: string,
  ) {
    return this.pilot.collect(u, b);
  }
  @Post('bookings/:bookingId/review') review(
    @CurrentUser() u: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) b: string,
    @Body() dto: ReviewDto,
  ) {
    return this.pilot.review(u, b, dto.stars, dto.comment ?? '');
  }
}
// Scoped, short-lived upload credential: does not grant reads or business writes.
@Controller('rides')
@UseGuards(PilotRateLimitGuard)
export class PilotUploadController {
  constructor(private readonly pilot: PilotService) {}
  @Post(':rideId/tracking/locations') upload(
    @Param('rideId', ParseUUIDPipe) r: string,
    @Body() dto: UploadDto,
  ) {
    return this.pilot.upload(r, dto.sessionId, dto.uploadToken, dto.samples);
  }
  @Post(':rideId/tracking/locations/close') close(
    @Param('rideId', ParseUUIDPipe) r: string,
    @Body() dto: CloseUploadDto,
  ) {
    return this.pilot.revokeUpload(r, dto.sessionId, dto.uploadToken);
  }
}
