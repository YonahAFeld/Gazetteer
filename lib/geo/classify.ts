/**
 * classifyOsmTags — map raw OSM tags to a Gazetteer place `kind` (SPEC.md §4.3).
 *
 * Pure and total: given the tags of a resolved OSM element, return exactly one
 * kind. Operates on real OSM tags (post-Overpass), not tile-layer classes.
 *
 * Spec mapping:
 *   boundary=administrative + admin_level 2 → country, 4 → state, 6 → county,
 *     8 → city, 9–10 → neighborhood
 *   place=suburb/neighbourhood → neighborhood
 *   everything named with no admin role → poi
 */

export type PlaceKind =
  | "poi"
  | "building"
  | "neighborhood"
  | "locality"
  | "city"
  | "county"
  | "state"
  | "country"
  | "custom";

export type OsmTags = Record<string, string | undefined>;

/** admin_level → kind. Ranges tolerate odd levels some countries use. */
function kindForAdminLevel(level: number | undefined): PlaceKind {
  if (level === undefined || Number.isNaN(level)) return "locality";
  if (level <= 2) return "country";
  if (level <= 4) return "state";
  if (level <= 6) return "county";
  if (level <= 8) return "city";
  return "neighborhood"; // 9, 10, 11…
}

/** place=* → kind. */
function kindForPlace(place: string): PlaceKind | null {
  switch (place) {
    case "country":
      return "country";
    case "state":
    case "province":
    case "region":
      return "state";
    case "county":
    case "district":
      return "county";
    case "city":
    case "town":
      return "city";
    case "village":
    case "hamlet":
    case "isolated_dwelling":
    case "locality":
      return "locality";
    case "suburb":
    case "neighbourhood":
    case "neighborhood":
    case "quarter":
    case "borough":
    case "city_block":
      return "neighborhood";
    default:
      return null; // island, islet, etc. fall through to POI handling
  }
}

// Tag keys that mark a feature as a point of interest rather than a container.
const POI_KEYS = [
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "office",
  "craft",
  "healthcare",
  "historic",
  "man_made",
  "aeroway",
  "railway",
  "public_transport",
  "emergency",
  "club",
];

function isPoiish(tags: OsmTags): boolean {
  return POI_KEYS.some((k) => tags[k] !== undefined && tags[k] !== "no");
}

export function classifyOsmTags(tags: OsmTags): PlaceKind {
  // 1. Administrative areas are classified by admin_level.
  if (tags.boundary === "administrative") {
    const level = tags.admin_level !== undefined ? parseInt(tags.admin_level, 10) : undefined;
    return kindForAdminLevel(level);
  }

  // 2. Populated places and named regions via place=*.
  if (tags.place) {
    const byPlace = kindForPlace(tags.place);
    if (byPlace) return byPlace;
  }

  // 3. Points of interest (named businesses, stations, monuments, …).
  if (isPoiish(tags)) return "poi";

  // 4. Plain buildings with no POI role.
  if (tags.building !== undefined && tags.building !== "no") return "building";

  // 5. Anything else that made it here (named, no admin role) is a POI.
  return "poi";
}
