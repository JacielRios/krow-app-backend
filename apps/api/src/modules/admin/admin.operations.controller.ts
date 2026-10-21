import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/presentation/admin.guard.js';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { AdminOperations } from './admin.operations.js';
class IncidentQuery {
  @IsOptional() @IsIn(['open', 'acknowledged', 'resolved']) status?: string;
}
class HandleIncidentDto {
  @IsIn(['acknowledged', 'resolved']) status!: string;
  @IsString() @MaxLength(2000) resolution!: string;
}
@Controller('admin/operations')
@UseGuards(SupabaseAuthGuard, AdminGuard)
export class AdminOperationsController {
  constructor(private readonly operations: AdminOperations) {}
  @Get() overview(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.overview(user);
  }
  @Get('incidents') incidents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IncidentQuery,
  ) {
    return this.operations.incidents(user, query.status);
  }
  @Patch('incidents/:id') handle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandleIncidentDto,
  ) {
    return this.operations.update(user, id, dto.status, dto.resolution);
  }
}
