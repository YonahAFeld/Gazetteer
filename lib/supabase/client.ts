import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key). Safe to use in Client Components.
 * Reads/writes are governed by RLS — this client can never bypass it.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
