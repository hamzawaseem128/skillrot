import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Supabase is optional. When it isn't configured the app runs against the
 * in-process store in `lib/store.ts` (see PRD §9 — reliability over breadth).
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

// All database access is server-side (API routes) via the service-role client
// below. There is deliberately no browser client: the pages talk to /api/*,
// and an anon-key client created at import time would be dead weight shipped
// to every page.

let serverClient: SupabaseClient | null = null;

/**
 * Server-side client using the service role key. Created lazily so that merely
 * importing this module never throws in an unconfigured environment.
 *
 * Never import this into a Client Component — the service role key bypasses RLS.
 */
export function supabaseServer(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  serverClient ??= createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return serverClient;
}
