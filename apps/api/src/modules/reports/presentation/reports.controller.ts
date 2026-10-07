import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/domain/authenticated-user.js';
import { CurrentUser } from '../../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../../auth/presentation/supabase-auth.guard.js';
import { AdminGuard } from '../../auth/presentation/admin.guard.js';
import { ReportsService } from '../application/reports.service.js';
import { DashboardSummaryQueryDto } from './reports.dto.js';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard-summary')
  dashboardSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardSummaryQueryDto,
  ) {
    return this.reports.dashboardSummary(user, query);
  }
}
