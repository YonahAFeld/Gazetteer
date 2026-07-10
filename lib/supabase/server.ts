import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client (anon key) bound to the request's auth cookies.
 * Use in Server Components, Route Handlers, and Server Actions. Still governed
 * by RLS — it acts as the signed-in user (or anonymous).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component (read-only cookies). Safe to ignore
            // when middleware is responsible for refreshing the session.
          }
        },
      },
    }
  );
}
