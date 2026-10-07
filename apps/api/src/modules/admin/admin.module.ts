import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module.js';
import { PilotModule } from '../pilot/pilot.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, SupabaseModule, PilotModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
