import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { UsersService } from './users.service.js';
import { UpsertProfileDto } from './profile.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.me(user);
  }
  @Put('profile')
  upsertProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() profile: UpsertProfileDto,
  ) {
    return this.users.upsertProfile(user, profile);
  }
}
