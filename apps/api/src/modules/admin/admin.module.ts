import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module.js';
import { PilotModule } from '../pilot/pilot.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminOperations } from './admin.operations.js';
import { AdminOperationsController } from './admin.operations.controller.js';

@Module({
  imports: [AuthModule, SupabaseModule, PilotModule],
  controllers: [AdminController, AdminOperationsController],
  providers: [AdminService, AdminOperations],
})
export class AdminModule {}
