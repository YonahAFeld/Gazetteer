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

/** Format a coordinate the way a chart legend would: "34.1575° N  118.4869° W". */
export function formatCoords(lat: number, lng: number): string {
  const fmt = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return `${fmt(lat, "N", "S")}  ${fmt(lng, "E", "W")}`;
}
