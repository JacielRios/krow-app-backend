import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsService } from './application/reports.service.js';
import { ReportsController } from './presentation/reports.controller.js';

@Module({
  imports: [SupabaseModule, AuthModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
