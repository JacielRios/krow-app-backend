import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { BookingsService } from '../application/bookings.service.js';
import { BookingStatusReasonDto, RequestBookingDto } from './booking.dto.js';

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Get('bookings/mine/active') active(@CurrentUser() user: AuthenticatedUser) {
    return this.bookings.activeRideIds(user);
  }
  @Get('bookings/pending-count') pendingCount(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.pendingCount(user);
  }
  @Post('rides/:rideId/bookings') request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RequestBookingDto,
  ) {
    return this.bookings.request(user, rideId, dto);
  }
  @Post('bookings/:bookingId/accept') accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto?: BookingStatusReasonDto,
  ) {
    return this.bookings.accept(user, bookingId, dto?.reason);
  }
  @Post('bookings/:bookingId/reject') reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto?: BookingStatusReasonDto,
  ) {
    return this.bookings.reject(user, bookingId, dto?.reason);
  }
  @Post('bookings/:bookingId/cancel') cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto?: BookingStatusReasonDto,
  ) {
    return this.bookings.cancel(user, bookingId, dto?.reason);
  }
}
