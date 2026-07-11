import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key). Safe to use in Client Components.
 * Reads/writes are governed by RLS — this client can never bypass it.
 *
 * Client Components render once in Node during `next build`'s static
 * prerender of "/" (before any browser exists), so a missing env var here
 * used to throw @supabase/ssr's constructor error at *build time* — killing
 * the whole deployment and leaving Vercel silently serving the last good
 * build. That prerender pass never calls Supabase (effects don't run during
 * it), so it's safe to hand it harmless placeholders instead of crashing.
 * A real browser with the same misconfiguration still throws immediately —
 * failing loud in that user's console/error boundary, not the build.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if ((!url || !anonKey) && typeof window === "undefined") {
    return createBrowserClient("https://placeholder.invalid", "placeholder-anon-key");
  }

  return createBrowserClient(url!, anonKey!);
}
