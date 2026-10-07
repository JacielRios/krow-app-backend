'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;
export function getAdminSupabase() {
  if (typeof window === 'undefined')
    throw new Error('El acceso administrativo requiere un navegador.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error('Falta configurar el acceso administrativo de Supabase.');
  client ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'krow-admin-auth',
    },
  });
  return client;
}
