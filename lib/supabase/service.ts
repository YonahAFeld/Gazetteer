import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES RLS — full read/write access.
 *
 * Server-only. Never import this into a Client Component or expose the key to
 * the browser. Used by trusted server routes (e.g. OSM hydration writing places
 * and ancestry). Guard every use with your own authorization checks.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
