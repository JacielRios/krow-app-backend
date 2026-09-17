import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './presentation/supabase-auth.guard.js';

@Module({ providers: [SupabaseAuthGuard], exports: [SupabaseAuthGuard] })
export class AuthModule {}
