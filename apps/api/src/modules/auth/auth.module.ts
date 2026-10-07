import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './presentation/supabase-auth.guard.js';
import { AdminGuard } from './presentation/admin.guard.js';

@Module({
  providers: [SupabaseAuthGuard, AdminGuard],
  exports: [SupabaseAuthGuard, AdminGuard],
})
export class AuthModule {}
