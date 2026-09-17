import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

@Injectable()
export class SupabaseService {
  private readonly url: string;
  private readonly anonKey: string;
  private readonly authClient: SupabaseClient<Database>;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('SUPABASE_URL');
    this.anonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
    this.authClient = createClient<Database>(
      this.url,
      this.anonKey,
      this.options(),
    );
  }

  async getUser(accessToken: string) {
    return this.authClient.auth.getUser(accessToken);
  }

  forUser(accessToken: string): SupabaseClient<Database> {
    return createClient<Database>(this.url, this.anonKey, {
      ...this.options(),
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  private options() {
    return {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
  }
}
