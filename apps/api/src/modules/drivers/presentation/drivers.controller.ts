import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { DashboardSummaryQueryDto } from '../../reports/presentation/reports.dto.js';
import { DriversService } from '../application/drivers.service.js';

export const RIDE_STATUSES = [
  'scheduled',
  'full',
  'in_progress',
  'completed',
  'cancelled',
] as const;

// Filtros del historial de viajes del conductor. Nunca incluye un id de
// conductor: el conductor sale siempre del token verificado.
export class DriverRidesQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string; // formato YYYY-MM-DD

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;

  @IsOptional()
  @IsIn(RIDE_STATUSES)
  status?: (typeof RIDE_STATUSES)[number];

  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/)
  page?: string;

  @IsOptional()
  @Matches(/^([1-9]|[1-4]\d|50)$/)
  pageSize?: string; // de 1 a 50
}

// Reporte semanal: una semana va de lunes a domingo (hora de Monterrey).
export class DriverWeeklyReportQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  weekStart!: string; // lunes de la semana, formato YYYY-MM-DD
}

// Todas las rutas son "me": el conductor se deduce del token, nunca de la URL.
@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.me(user);
  }

  @Get('me/profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.profile(user);
  }

  @Get('me/dashboard-summary')
  dashboardSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardSummaryQueryDto,
  ) {
    return this.drivers.dashboardSummary(user, query);
  }

  @Get('me/rides')
  rides(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DriverRidesQueryDto,
  ) {
    return this.drivers.rides(user, query);
  }

  @Get('me/weekly-report')
  weeklyReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DriverWeeklyReportQueryDto,
  ) {
    return this.drivers.weeklyReport(user, query);
  }
}
