/** A selected place as the client sees it (API response shape). */
export interface Place {
  id: string;
  osm_type: string | null;
  osm_id: number | null;
  kind: string;
  name: string;
  admin_level: number | null;
  lng: number;
  lat: number;
  hasBoundary: boolean;
}

/** Human-readable, map-legend-voice label for a place kind (SPEC.md §7). */
export const KIND_LABELS: Record<string, string> = {
  poi: "Point of Interest",
  building: "Building",
  neighborhood: "Neighborhood",
  locality: "Locality",
  city: "City",
  county: "County",
  state: "State",
  country: "Country",
  custom: "Custom Place",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// Zoom-out-enough-to-see-the-chip per place `kind` — same idea as search's
// ZOOM_BY_TYPE, but keyed on our own kind vocabulary instead of Nominatim's,
// for deep links that open straight onto a stored place.
const ZOOM_BY_KIND: Record<string, number> = {
  country: 4,
  state: 6,
  county: 8,
  city: 11,
  locality: 13,
  neighborhood: 14,
  building: 16,
  poi: 16,
  custom: 16,
};

export function zoomForKind(kind: string): number {
  return ZOOM_BY_KIND[kind] ?? 15;
}

/** Format a coordinate the way a chart legend would: "34.1575° N  118.4869° W". */
export function formatCoords(lat: number, lng: number): string {
  const fmt = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return `${fmt(lat, "N", "S")}  ${fmt(lng, "E", "W")}`;
}
