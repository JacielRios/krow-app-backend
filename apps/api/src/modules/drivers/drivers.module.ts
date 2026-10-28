import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DriversService } from './application/drivers.service.js';
import { DriversController } from './presentation/drivers.controller.js';

// ⚠️ Copia en `imports` lo mismo que tenga reports.module.ts (de donde sale
// PilotDatabase). Después registra DriversModule en app.module.ts.
@Module({
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
