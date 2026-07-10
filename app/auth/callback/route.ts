import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback. Both magic-link and Google OAuth redirect here with a `code`
 * (PKCE) that we exchange for a session cookie, then bounce the user back to
 * where they started (`next`, defaults to the map root).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      // Respect the platform's forwarded host in production (Vercel) so the
      // redirect doesn't drop to the internal origin behind a proxy.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;
      return NextResponse.redirect(`${base}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(exchangeError.message)}`
    );
  }

  return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
}
