import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { CurrentUser } from '../auth/presentation/current-user.decorator.js';
import { SupabaseAuthGuard } from '../auth/presentation/supabase-auth.guard.js';
import { AdminGuard } from '../auth/presentation/admin.guard.js';
import { AdminService } from './admin.service.js';
import {
  AdminAuditListDto,
  AdminDocumentListDto,
  AdminDriverListDto,
  AdminListDto,
  AdminRideListDto,
  AdminStatusDto,
  AdminVehicleListDto,
  CreateAdminDocumentDto,
  CreateAdminDriverDto,
  CreateAdminVehicleDto,
  UpdateAdminDocumentDto,
  UpdateAdminDriverDto,
  UpdateAdminVehicleDto,
} from './admin.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.me(user);
  }
  @Get('users') users(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminListDto,
  ) {
    return this.admin.users(user, dto);
  }
  @Get('drivers') drivers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminDriverListDto,
  ) {
    return this.admin.drivers(user, dto);
  }
  @Get('drivers/:id') driver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.driver(user, id);
  }
  @Post('drivers') createDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdminDriverDto,
  ) {
    return this.admin.createDriver(user, dto);
  }
  @Patch('drivers/:id') updateDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDriverDto,
  ) {
    return this.admin.updateDriver(user, id, dto);
  }
  @Patch('drivers/:id/status') driverStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminStatusDto,
  ) {
    return this.admin.driverStatus(user, id, dto);
  }
  @Get('vehicles') vehicles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminVehicleListDto,
  ) {
    return this.admin.vehicles(user, dto);
  }
  @Post('vehicles') createVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdminVehicleDto,
  ) {
    return this.admin.createVehicle(user, dto);
  }
  @Patch('vehicles/:id') updateVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminVehicleDto,
  ) {
    return this.admin.updateVehicle(user, id, dto);
  }
  @Delete('vehicles/:id') retireVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.updateVehicle(user, id, { status: 'inactive' });
  }
  @Get('documents') documents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminDocumentListDto,
  ) {
    return this.admin.documents(user, dto);
  }
  @Post('documents/uploads') upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdminDocumentDto,
  ) {
    return this.admin.upload(user, dto);
  }
  @Post('documents/:id/complete') completeUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.completeUpload(user, id);
  }
  @Patch('documents/:id') updateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDocumentDto,
  ) {
    return this.admin.updateDocument(user, id, dto);
  }
  @Post('documents/:id/download') download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.download(user, id);
  }
  @Get('rides') rides(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminRideListDto,
  ) {
    return this.admin.rides(user, dto);
  }
  @Get('rides/:id') ride(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.ride(user, id);
  }
  @Get('audit') audit(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AdminAuditListDto,
  ) {
    return this.admin.audit(user, dto);
  }
}
