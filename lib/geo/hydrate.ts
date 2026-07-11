/**
 * OSM hydration orchestrator (SPEC.md §4). Turns a tapped tile feature into a
 * persisted `places` row, doing the least work possible:
 *
 *   1. DB-first: if a place with this numeric OSM id is already stored, return
 *      it — no Overpass (SPEC.md Phase 2 criterion: repeat taps hit the DB).
 *   2. Else resolve identity + tags via Overpass (cached 30 days in osm_cache).
 *   3. classifyOsmTags → kind, upsert via the hydrate_place RPC.
 *
 * Runs on the server with the service-role client (bypasses RLS to write places
 * and read/write the cache).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyOsmTags } from "./classify";
import {
  osmIdFromFeatureId,
  resolveOsmElement,
  type ResolvedOsmElement,
} from "./overpass";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// OSM often models one real-world place as several elements (e.g. a city's
// boundary relation vs. its separate label node). Before inserting a *new*
// osm_type/osm_id as its own place, check whether an existing place of the
// same kind+name already sits within this radius — if so, treat the new
// element as an alias instead of splitting the chat in two. Radius scales
// with how large/imprecise a kind's "centroid" tends to be; 0 disables dedup
// (custom pins are user-authored and must never merge).
const DEDUP_RADIUS_M: Record<string, number> = {
  country: 300_000,
  state: 150_000,
  county: 50_000,
  city: 20_000,
  locality: 10_000,
  neighborhood: 3_000,
  poi: 250,
  building: 100,
  custom: 0,
};

export interface HydrateInput {
  /** MVT feature id (encoded). Optional if osmId is provided directly. */
  featureId?: number | string;
  osmId?: number;
  name: string;
  lng: number;
  lat: number;
}

export interface HydratedPlace {
  id: string;
  osm_type: string | null;
  osm_id: number | null;
  kind: string;
  name: string;
  admin_level: number | null;
  lng: number;
  lat: number;
  hasBoundary: boolean;
  source: "db" | "overpass";
}

interface PlaceReaderRow {
  id: string;
  osm_type: string | null;
  osm_id: number | null;
  kind: string;
  name: string;
  admin_level: number | null;
  lng: number;
  lat: number;
  has_boundary: boolean;
}

function readerToPlace(row: PlaceReaderRow, source: "db" | "overpass"): HydratedPlace {
  return {
    id: row.id,
    osm_type: row.osm_type,
    osm_id: row.osm_id,
    kind: row.kind,
    name: row.name,
    admin_level: row.admin_level,
    lng: row.lng,
    lat: row.lat,
    hasBoundary: row.has_boundary,
    source,
  };
}

/** DB-first lookup by numeric OSM id; disambiguates by name if several share it. */
async function findStored(
  service: SupabaseClient,
  osmId: number,
  name: string,
  source: "db" | "overpass"
): Promise<HydratedPlace | null> {
  const { data } = await service.rpc("place_by_osm_id", { p_osm_id: osmId });
  const rows = (data ?? []) as PlaceReaderRow[];
  if (rows.length === 0) return null;
  if (rows.length === 1) return readerToPlace(rows[0], source);
  const wanted = name.trim().toLowerCase();
  const match = rows.find((r) => r.name.trim().toLowerCase() === wanted);
  return readerToPlace(match ?? rows[0], source);
}

async function cachedResolve(
  service: SupabaseClient,
  osmId: number,
  name: string
): Promise<ResolvedOsmElement | null> {
  // Before resolution we only have the numeric id, so cache under a synthetic
  // "lookup" type keyed by that id.
  const cacheKey = { osm_type: "lookup", osm_id: osmId };
  const { data: cached } = await service
    .from("osm_cache")
    .select("raw, fetched_at")
    .match(cacheKey)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return cached.raw as ResolvedOsmElement | null;
  }

  const resolved = await resolveOsmElement(osmId, name);
  await service
    .from("osm_cache")
    .upsert({ ...cacheKey, raw: resolved ?? null, fetched_at: new Date().toISOString() });
  return resolved;
}

export async function hydratePlace(
  service: SupabaseClient,
  input: HydrateInput
): Promise<HydratedPlace | null> {
  const osmId =
    input.osmId ?? (input.featureId != null ? osmIdFromFeatureId(input.featureId) : undefined);
  if (osmId == null || Number.isNaN(osmId)) return null;

  // 1. DB-first — repeat taps never reach Overpass.
  const stored = await findStored(service, osmId, input.name, "db");
  if (stored) return stored;

  // 2. Resolve identity + tags via Overpass (cached).
  const resolved = await cachedResolve(service, osmId, input.name);
  if (!resolved) return null;

  // 3. Classify, then check for an existing place this OSM element is
  // probably just another representation of — OSM often models one real
  // place as several elements (a city's boundary relation vs. its separate
  // label node), and identity-per-osm-element shouldn't fork one place's
  // chat into two just because a tap resolved a different element.
  const kind = classifyOsmTags(resolved.tags);
  const radius = DEDUP_RADIUS_M[kind] ?? 0;
  if (radius > 0) {
    const { data: nearby } = await service.rpc("place_by_name_near", {
      p_kind: kind,
      p_name: resolved.name,
      p_lng: resolved.lng,
      p_lat: resolved.lat,
      p_radius_m: radius,
    });
    const aliasOf = ((nearby ?? []) as PlaceReaderRow[])[0];
    if (aliasOf) return readerToPlace(aliasOf, "overpass");
  }

  // 4. No existing alias — upsert this element as its own place, then read
  // it back projected to lng/lat.
  const { error } = await service.rpc("hydrate_place", {
    p_osm_type: resolved.osm_type,
    p_osm_id: resolved.osm_id,
    p_kind: kind,
    p_name: resolved.name,
    p_lng: resolved.lng,
    p_lat: resolved.lat,
    p_admin_level: resolved.admin_level,
    p_boundary_geojson: null, // polygons arrive in Phase 3
  });
  if (error) return null;

  return findStored(service, resolved.osm_id, resolved.name, "overpass");
}

/** Insert a user-created custom pin (SPEC.md §4, auth-gated upstream). */
export async function createCustomPin(
  service: SupabaseClient,
  input: { name: string; lng: number; lat: number; createdBy: string }
): Promise<HydratedPlace | null> {
  const { data, error } = await service
    .from("places")
    .insert({
      kind: "custom",
      name: input.name,
      centroid: `POINT(${input.lng} ${input.lat})`,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return null;

  const { data: rows } = await service.rpc("place_by_id", { p_id: data.id });
  const row = ((rows ?? []) as PlaceReaderRow[])[0];
  return row ? readerToPlace(row, "overpass") : null;
}
