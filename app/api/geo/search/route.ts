import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Nominatim is slow and rate-limit sensitive; keep this off the edge.
export const runtime = "nodejs";
export const maxDuration = 15;

interface NominatimResult {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export interface SearchResult {
  osmId: number;
  name: string;
  lng: number;
  lat: number;
}

/**
 * Thin, rate-limited proxy to Nominatim (SPEC.md §1, §5). Two limits: a
 * generous per-client one to stop abuse of our route, and a strict global one
 * (Nominatim's usage policy caps public-instance callers at 1 req/sec).
 */
export async function GET(req: Request) {
  const { allowed: clientOk } = rateLimit(clientIp(req), { limit: 20, windowMs: 60_000 });
  if (!clientOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const { allowed: nominatimOk, retryAfter } = rateLimit("nominatim-global", {
    limit: 1,
    windowMs: 1100,
  });
  if (!nominatimOk) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Gazetteer/0.1 (https://github.com/YonahAFeld/Gazetteer)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ results: [] });

    const raw = (await res.json()) as NominatimResult[];
    const results: SearchResult[] = raw
      .filter((r) => r.osm_id && r.osm_type)
      .map((r) => ({
        osmId: r.osm_id,
        name: r.display_name,
        lng: parseFloat(r.lon),
        lat: parseFloat(r.lat),
      }));
    return NextResponse.json({ results });
  } catch (e) {
    console.error("search error:", e);
    return NextResponse.json({ results: [] });
  }
}
