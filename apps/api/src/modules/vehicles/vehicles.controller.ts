import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { VehiclesService } from './vehicles.service.js';

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.vehicles.list(user);
  }
}
