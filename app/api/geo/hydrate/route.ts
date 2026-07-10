import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { hydratePlace } from "@/lib/geo/hydrate";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Overpass calls need Node APIs and are slow; keep this off the edge.
export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  featureId?: number | string;
  osmId?: number;
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { featureId, osmId, name, lng, lat } = body;
  if (
    (featureId == null && osmId == null) ||
    typeof lng !== "number" ||
    typeof lat !== "number"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const place = await hydratePlace(service, {
      featureId,
      osmId,
      name: name ?? "Unnamed place",
      lng,
      lat,
    });
    if (!place) {
      return NextResponse.json({ error: "not_resolved" }, { status: 404 });
    }
    return NextResponse.json({ place });
  } catch (e) {
    console.error("hydrate error:", e);
    return NextResponse.json({ error: "hydrate_failed" }, { status: 502 });
  }
}
