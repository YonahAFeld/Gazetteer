/**
 * Overpass access, wrapped so the provider stays swappable (SPEC.md §1, §4).
 *
 * OpenFreeMap tiles don't expose OSM ids as properties; they encode them in the
 * MVT feature id as `osm_id * 10 + typeCode`, and the type code is unreliable
 * (see docs/ARCHITECTURE.md). So we take the numeric id from `floor(featureId/10)`
 * and resolve the node/way/relation here by asking Overpass for all three and
 * picking the tagged element (disambiguating by name when needed).
 */

import type { OsmTags } from "./classify";

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT ?? "https://overpass-api.de/api/interpreter";

export type OsmType = "node" | "way" | "relation";

export interface ResolvedOsmElement {
  osm_type: OsmType;
  osm_id: number;
  name: string;
  tags: OsmTags;
  lng: number;
  lat: number;
  /** Present for admin boundaries. */
  admin_level: number | null;
}

interface OverpassElement {
  type: OsmType;
  id: number;
  tags?: OsmTags;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

export function osmIdFromFeatureId(featureId: number | string): number {
  return Math.floor(Number(featureId) / 10);
}

async function overpass(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Gazetteer/0.1 (https://github.com/YonahAFeld/Gazetteer)",
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(query),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { elements?: OverpassElement[] };
  return json.elements ?? [];
}

function elementCoords(el: OverpassElement): { lng: number; lat: number } | null {
  if (el.lat !== undefined && el.lon !== undefined) return { lng: el.lon, lat: el.lat };
  if (el.center) return { lng: el.center.lon, lat: el.center.lat };
  return null;
}

function toResolved(el: OverpassElement, fallbackName: string): ResolvedOsmElement | null {
  const coords = elementCoords(el);
  if (!coords) return null;
  const tags = el.tags ?? {};
  const adminLevel = tags.admin_level ? parseInt(tags.admin_level, 10) : NaN;
  return {
    osm_type: el.type,
    osm_id: el.id,
    name: tags.name ?? tags["name:en"] ?? fallbackName,
    tags,
    lng: coords.lng,
    lat: coords.lat,
    admin_level: Number.isNaN(adminLevel) ? null : adminLevel,
  };
}

/**
 * Resolve a tapped tile feature to its canonical OSM element.
 *
 * @param osmId  numeric id from `osmIdFromFeatureId`
 * @param name   the tapped feature's label, used to disambiguate
 */
export async function resolveOsmElement(
  osmId: number,
  name: string,
  signal?: AbortSignal
): Promise<ResolvedOsmElement | null> {
  const query =
    `[out:json][timeout:25];` +
    `(node(${osmId});way(${osmId});relation(${osmId}););` +
    `out tags center;`;
  const elements = await overpass(query, signal);

  // Keep only elements that actually carry tags (an untagged geometry row for a
  // different type sharing the numeric id is not our feature).
  const tagged = elements.filter((el) => el.tags && Object.keys(el.tags).length > 0);
  if (tagged.length === 0) return null;
  if (tagged.length === 1) return toResolved(tagged[0], name);

  // Multiple types share this numeric id — prefer an exact name match.
  const wanted = name.trim().toLowerCase();
  const byName = tagged.find(
    (el) =>
      (el.tags?.name ?? el.tags?.["name:en"] ?? "").trim().toLowerCase() === wanted
  );
  return toResolved(byName ?? tagged[0], name);
}
