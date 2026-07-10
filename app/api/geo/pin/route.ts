import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCustomPin } from "@/lib/geo/hydrate";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface Body {
  name?: string;
  lng?: number;
  lat?: number;
}

export async function POST(req: Request) {
  const { allowed, retryAfter } = rateLimit(clientIp(req), { limit: 10, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // Custom pins are auth-gated: insert as the signed-in user so the places RLS
  // policy (kind='custom', created_by = auth.uid()) enforces ownership.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name || typeof body.lng !== "number" || typeof body.lat !== "number") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  try {
    const place = await createCustomPin(supabase, {
      name,
      lng: body.lng,
      lat: body.lat,
      createdBy: user.id,
    });
    if (!place) {
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
    return NextResponse.json({ place });
  } catch (e) {
    console.error("pin error:", e);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
