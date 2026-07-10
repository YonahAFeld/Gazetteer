import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

/**
 * "The Survey" base map transform (spec §7).
 *
 * OpenFreeMap Liberty ships a full-color OSM style. We want a desaturated
 * chart-paper variant so the magenta selection and ink UI read clearly on top —
 * but water must stay recognizably blue (nautical-chart convention). We do this
 * by walking the style's static color paint properties and:
 *   - land / landcover / buildings  → desaturate hard, nudge toward paper
 *   - water / waterways             → recolor to a muted hydrographic blue
 *   - labels                        → push toward ink for a printed feel
 *
 * All Liberty color paint values are static strings (verified: no data-driven
 * expressions on color props), so a string-in/string-out pass is sufficient.
 */

/**
 * A map vibe. The transform below reads only from the active theme, so changing
 * the whole look is a one-object swap. See DECISIONS.md for the vibe history.
 */
interface MapTheme {
  /** Map background (shows as open ocean at low zoom) + label halos. */
  background: string;
  /** Land: keep this much of the original saturation (1 = untouched). */
  landSat: number;
  /** Land: lift lightness this fraction of the way toward `landLiftTarget`. */
  landLift: number;
  landLiftTarget: number;
  /** Water recolor. */
  water: { h: number; s: number; fillL: [number, number]; lineL: [number, number]; labelL: [number, number] };
  /** Labels: keep this much saturation; cap lightness so they stay legible ink. */
  labelSat: number;
  labelMaxL: number;
  /** Hover color for clickable labels (hyperlink-style). */
  hover: string;
}

// Active vibe: "Modern Vivid" — bright, friendly, mostly true-to-life color with
// a clean near-white ground; magenta stays the selection accent.
const THEME: MapTheme = {
  background: "#FBFBF9",
  landSat: 0.95,
  landLift: 0.06,
  landLiftTarget: 0.99,
  water: { h: 205, s: 0.5, fillL: [0.7, 0.86], lineL: [0.42, 0.72], labelL: [0.3, 0.58] },
  labelSat: 0.55,
  labelMaxL: 0.42,
  hover: "#3B6FA0",
};

const PAPER = THEME.background; // background + label halos
const WATER = THEME.hover; // hover/link color used by the hover affordance
const COLOR_PAINT_PROPS = [
  "background-color",
  "fill-color",
  "fill-outline-color",
  "fill-extrusion-color",
  "line-color",
  "text-color",
] as const;

// Symbol layers from these source layers are clickable places; their labels get
// a hover affordance (turn hydrographic-blue like a hyperlink) via feature-state.
const HOVERABLE_SOURCE_LAYERS = new Set([
  "poi",
  "place",
  "water_name",
  "mountain_peak",
  "aerodrome_label",
]);

type RGBA = { r: number; g: number; b: number; a: number };
type HSL = { h: number; s: number; l: number; a: number };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function parseColor(input: string): RGBA | null {
  const str = input.trim().toLowerCase();

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if (str[0] === "#") {
    const hex = str.slice(1);
    const expand = (h: string) =>
      h.length === 3 || h.length === 4
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const h = expand(hex);
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgbMatch = str.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    return {
      r: clamp(parseFloat(parts[0]), 0, 255),
      g: clamp(parseFloat(parts[1]), 0, 255),
      b: clamp(parseFloat(parts[2]), 0, 255),
      a: parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1,
    };
  }

  const hslMatch = str.match(/^hsla?\(([^)]+)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1;
    return hslToRgba({ h, s, l, a });
  }

  return null;
}

function rgbaToHsl({ r, g, b, a }: RGBA): HSL {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l, a };
}

function hslToRgba({ h, s, l, a }: HSL): RGBA {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a,
  };
}

function toRgbaString({ r, g, b, a }: RGBA): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

type LayerGroup = "water" | "label" | "land";

function classifyLayer(layer: LayerSpecification): LayerGroup {
  const id = layer.id.toLowerCase();
  const sourceLayer = ("source-layer" in layer ? layer["source-layer"] : "") ?? "";
  if (/water|waterway|ocean|sea|lake|river/.test(id) || /water/.test(sourceLayer)) {
    return "water";
  }
  if (layer.type === "symbol") return "label";
  return "land";
}

function transformColor(value: string, group: LayerGroup, prop: string): string {
  const rgba = parseColor(value);
  if (!rgba) return value;
  const hsl = rgbaToHsl(rgba);

  if (group === "water") {
    // Recolor water to a consistent blue; keep fills bright and lines/labels
    // darker by clamping lightness into per-role bands.
    const band =
      prop === "text-color"
        ? THEME.water.labelL
        : prop === "line-color"
        ? THEME.water.lineL
        : THEME.water.fillL;
    return toRgbaString(
      hslToRgba({
        h: THEME.water.h,
        s: THEME.water.s,
        l: clamp(hsl.l, band[0], band[1]),
        a: rgba.a,
      })
    );
  }

  if (group === "label") {
    if (prop === "text-color") {
      // Keep labels dark and legible; drop just enough saturation for crisp ink.
      return toRgbaString(
        hslToRgba({
          h: hsl.h,
          s: hsl.s * THEME.labelSat,
          l: clamp(hsl.l * 0.92, 0, THEME.labelMaxL),
          a: rgba.a,
        })
      );
    }
    return value; // halos stay as-is (whitish)
  }

  // land: keep most of the original color, lift lightness slightly for a clean feel.
  return toRgbaString(
    hslToRgba({
      h: hsl.h,
      s: hsl.s * THEME.landSat,
      l: clamp(hsl.l + (THEME.landLiftTarget - hsl.l) * THEME.landLift, 0, 1),
      a: rgba.a,
    })
  );
}

/** Return a deep-cloned Liberty style recolored for "The Survey". */
export function surveyStyle(style: StyleSpecification): StyleSpecification {
  const next: StyleSpecification = structuredClone(style);
  for (const layer of next.layers) {
    if (layer.type === "background") {
      layer.paint = { ...(layer.paint ?? {}), "background-color": PAPER };
      continue;
    }
    const group = classifyLayer(layer);
    const paint = layer.paint as Record<string, unknown> | undefined;
    if (!paint) continue;
    for (const prop of COLOR_PAINT_PROPS) {
      const v = paint[prop];
      if (typeof v === "string") {
        paint[prop] = transformColor(v, group, prop);
      }
    }

    // Hover affordance: clickable place labels turn hydrographic-blue (like a
    // hyperlink) when their feature-state `hover` is set by the map canvas.
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (layer.type === "symbol" && sourceLayer && HOVERABLE_SOURCE_LAYERS.has(sourceLayer)) {
      const base = (paint["text-color"] as unknown) ?? "#1A1A18";
      paint["text-color"] = [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        WATER,
        base,
      ];
    }
  }

  tuneLabels(next);
  return next;
}

const INK = "#1A1A18";
const HOVER_TEXT_COLOR = [
  "case",
  ["boolean", ["feature-state", "hover"], false],
  WATER,
  INK,
];

/**
 * Rebalance which labels appear at which zoom (Gazetteer favors containers —
 * neighborhoods, parks, public spaces — over transit noise):
 *   - bus stops: drop from the always-on transit layer so they only surface when
 *     zoomed in (via the rank-gated POI layers), instead of at low zoom;
 *   - parks: add a label layer (Liberty ships none) so public spaces are visible
 *     and clickable, with higher collision priority than POIs;
 *   - neighborhoods: appear a touch earlier.
 */
function tuneLabels(style: StyleSpecification): void {
  const layers = style.layers as LayerSpecification[];

  const transit = layers.find((l) => l.id === "poi_transit");
  if (transit) {
    (transit as { filter?: unknown }).filter = [
      "match",
      ["get", "class"],
      ["airport", "rail"],
      true,
      false,
    ];
  }

  const other = layers.find((l) => l.id === "label_other");
  if (other) other.minzoom = 7;

  // Street/boulevard NAME labels aren't clickable here and clutter when zoomed
  // out, so hold them until you're zoomed in to street level.
  const STREET_NAME_FLOOR = 15;
  for (const id of ["highway-name-major", "highway-name-minor", "highway-name-path"]) {
    const l = layers.find((x) => x.id === id);
    if (l && (l.minzoom ?? 0) < STREET_NAME_FLOOR) l.minzoom = STREET_NAME_FLOOR;
  }

  if (!layers.some((l) => l.id === "park_label")) {
    const parkLabel = {
      id: "park_label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "park",
      minzoom: 11,
      filter: ["has", "name"],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 13],
        "text-max-width": 8,
        "symbol-placement": "point",
      },
      paint: {
        "text-color": HOVER_TEXT_COLOR,
        "text-halo-color": PAPER,
        "text-halo-width": 1.2,
      },
    } as unknown as LayerSpecification;

    // Insert before the POI layers so parks win collisions over transit/POI noise.
    const firstPoi = layers.findIndex((l) => "source-layer" in l && l["source-layer"] === "poi");
    layers.splice(firstPoi >= 0 ? firstPoi : layers.length, 0, parkLabel);
  }
}
