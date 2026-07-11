"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type StyleSpecification,
  type MapGeoJSONFeature,
  type LngLat,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { surveyStyle, CHIP_LAYER_IDS } from "./mapStyle";
import type { Place } from "@/lib/geo/types";

// OpenFreeMap Liberty is the default base. The architecture keeps this a single
// swappable constant so a self-hosted Protomaps PMTiles style can replace it later.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Selectable places come from these OpenMapTiles vector *source* layers. We key
// off sourceLayer, not the style layer id — Liberty renders place labels in
// layers named `label_city`, `label_country_2`, etc. (no "place" in the id).
const SELECTABLE_SOURCE_LAYERS = new Set([
  "poi",
  "place",
  "boundary",
  "park",
  "water_name",
  "mountain_peak",
  "aerodrome_label",
  "building",
]);

// Rank: prefer the most specific named target under a tap.
function sourceRank(sourceLayer: string | undefined): number {
  switch (sourceLayer) {
    case "poi":
      return 0;
    case "place":
    case "water_name":
    case "mountain_peak":
    case "aerodrome_label":
      return 1;
    case "park":
      return 2;
    case "building":
      return 3;
    case "boundary":
      return 4;
    default:
      return 9;
  }
}

export interface TapTarget {
  featureId: number | string;
  name: string;
  lng: number;
  lat: number;
}

export interface FlyToTarget {
  lng: number;
  lat: number;
  /** A city's label chip disappears if you fly in street-close, so the
   * caller picks a zoom appropriate to what's being flown to. */
  zoom: number;
  /** Bumped by the caller on every request so repeat flights to the same spot still fire. */
  token: number;
}

interface MapCanvasProps {
  selected: Place | null;
  loading: boolean;
  onTapFeature: (target: TapTarget) => void;
  onLongPress: (lngLat: { lng: number; lat: number }) => void;
  flyTo?: FlyToTarget | null;
  /** Deep-link entry point: open already centered here instead of geolocating.
   * Read once, at mount — later changes don't re-open the map. */
  initialView?: { lng: number; lat: number; zoom: number } | null;
}

/** Pick the most specific named, id-bearing feature under a tap. */
function pickFeature(features: MapGeoJSONFeature[]): MapGeoJSONFeature | null {
  const named = features.filter(
    (f) =>
      f.id != null &&
      SELECTABLE_SOURCE_LAYERS.has(f.sourceLayer ?? "") &&
      typeof f.properties?.name === "string"
  );
  if (named.length === 0) return null;
  named.sort((a, b) => sourceRank(a.sourceLayer) - sourceRank(b.sourceLayer));
  return named[0];
}

interface SelectionVisual {
  lng: number;
  lat: number;
  isChip: boolean;
  name: string;
}
type FeatureRef = { sourceLayer: string; id: string | number };

/**
 * Render the selection highlight from two STABLE-id point features ("prev",
 * "cur") in the "selection" source, rather than deriving position from
 * whatever the base map currently has rendered at a given pixel. This is the
 * crux of it: position always comes from the caller's stored place data
 * (deterministic, pan/zoom-proof), never re-queried from a transient label
 * render (which large multi-tile features can reposition or drop entirely).
 *
 * "prev" briefly holds the outgoing selection (fading toward invisible in
 * place) so switching between two places never flashes a moment of nothing
 * selected; "cur" is the incoming one, fading in. Paint-property transitions
 * on the "selection-chip"/"selection-point" layers do the actual animating.
 */
function setSelectionVisual(
  map: MapLibreMap,
  curRef: { current: SelectionVisual | null },
  next: SelectionVisual | null
) {
  const src = map.getSource("selection") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const cur = curRef.current;
  const feature = (id: string, v: SelectionVisual, active: boolean) => ({
    type: "Feature" as const,
    id,
    geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
    properties: { isChip: v.isChip, name: v.name, active },
  });
  const features: Array<ReturnType<typeof feature>> = [];
  if (next) {
    if (cur) features.push(feature("prev", cur, false));
    features.push(feature("cur", next, true));
  } else if (cur) {
    features.push(feature("cur", cur, false));
  }
  src.setData({ type: "FeatureCollection", features });
  curRef.current = next;
}

/** Clear feature-state on every base-label instance we'd previously suppressed. */
function clearSuppression(map: MapLibreMap, refs: { current: FeatureRef[] }) {
  for (const ref of refs.current) {
    map.setFeatureState({ source: "openmaptiles", sourceLayer: ref.sourceLayer, id: ref.id }, { selected: false });
  }
  refs.current = [];
}

/**
 * Rendered instances of the base label(s) this place corresponds to — used
 * ONLY to (a) decide chip-vs-dot treatment and (b) suppress the base label
 * while selected, never for positioning. Matches by exact OSM id first, then
 * falls back to name (OSM often models one real place as a different element
 * than the one hydration resolved to — e.g. a city's boundary relation vs.
 * its separate label node — the same duplicate-identity issue the hydration
 * dedup handles server-side).
 */
function findChipMatches(map: MapLibreMap, selected: Place): MapGeoJSONFeature[] {
  const candidates = map
    .queryRenderedFeatures()
    .filter((f) => f.id != null && SELECTABLE_SOURCE_LAYERS.has(f.sourceLayer ?? ""));
  let matches = candidates.filter((f) => Math.floor(Number(f.id) / 10) === selected.osm_id);
  if (matches.length === 0) {
    const wanted = selected.name.trim().toLowerCase();
    matches = candidates.filter(
      (f) => typeof f.properties?.name === "string" && f.properties.name.trim().toLowerCase() === wanted
    );
  }
  return matches.filter((m) => CHIP_LAYER_IDS.includes(m.layer.id));
}

// World view — the fallback when geolocation is denied, unavailable, or slow.
const WORLD_CENTER: [number, number] = [0, 20];
const WORLD_ZOOM = 2;
// "Neighborhood/city" zoom for a resolved user location (SPEC.md's browse-by-
// panning premise still holds — this just picks a friendlier starting point).
const LOCATED_ZOOM = 13;
const GEOLOCATE_TIMEOUT_MS = 6000;

/** Best-effort one-shot geolocation with a hard timeout; never rejects. */
function getInitialView(): Promise<{ center: [number, number]; zoom: number }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (view: { center: [number, number]; zoom: number }) => {
      if (settled) return;
      settled = true;
      resolve(view);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => done({ center: [pos.coords.longitude, pos.coords.latitude], zoom: LOCATED_ZOOM }),
      () => done({ center: WORLD_CENTER, zoom: WORLD_ZOOM }),
      { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS, maximumAge: 5 * 60 * 1000 }
    );
    // Belt-and-suspenders: some browsers don't honor the `timeout` option
    // reliably while the permission prompt is pending.
    setTimeout(() => done({ center: WORLD_CENTER, zoom: WORLD_ZOOM }), GEOLOCATE_TIMEOUT_MS + 500);
  });
}

export default function MapCanvas({
  selected,
  loading,
  onTapFeature,
  onLongPress,
  flyTo,
  initialView: initialViewProp,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const curVisualRef = useRef<SelectionVisual | null>(null);
  const suppressedRefs = useRef<FeatureRef[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    async function init() {
      const [styleResult, geoView] = await Promise.all([
        (async () => {
          let style: StyleSpecification | string = STYLE_URL;
          try {
            const res = await fetch(STYLE_URL);
            if (res.ok) style = surveyStyle((await res.json()) as StyleSpecification);
          } catch {
            /* fall back to the raw URL so the map still renders */
          }
          return style;
        })(),
        // A deep link already knows where to open — skip geolocation entirely
        // rather than racing it against a `flyTo` (which only fires once the
        // map instance exists, so it can't reliably override the very first paint).
        initialViewProp ? Promise.resolve(null) : getInitialView(),
      ]);
      const style = styleResult;
      const initialView = initialViewProp
        ? { center: [initialViewProp.lng, initialViewProp.lat] as [number, number], zoom: initialViewProp.zoom }
        : geoView!;
      if (cancelled || !container) return;

      const map = new maplibregl.Map({
        container,
        style,
        center: initialView.center,
        zoom: initialView.zoom,
        attributionControl: { compact: true },
        minZoom: 1,
        maxZoom: 19,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.GeolocateControl({}), "bottom-right");
      mapRef.current = map;

      // Stretchable capsule chip drawn behind clickable place labels
      // (mapStyle.ts references "place-pill"; MapCanvas's own "selection-chip"
      // layer references "place-pill-selected"). Both are fully opaque — the
      // selected variant draws its own text on top of "selection-chip"
      // (see the `selection` source below), independent of the base label
      // underneath, so it must fully cover that base text, not just outline it.
      const pr = 2;
      const S = 28; // logical canvas size; the rect is inset to leave shadow room
      const makePill = (name: string, border?: string) => {
        if (map.hasImage(name)) return;
        const c = document.createElement("canvas");
        c.width = S * pr;
        c.height = S * pr;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.scale(pr, pr);
        ctx.beginPath();
        ctx.roundRect(5, 5, 18, 16, 8);
        // White capsule with a soft drop shadow, Airbnb-price-pill style.
        ctx.shadowColor = "rgba(26,26,24,0.28)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        if (border) {
          // Selected variant: an additional colored outline, no shadow on the
          // stroke itself (would double up oddly with the fill's shadow).
          ctx.shadowColor = "transparent";
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = border;
          ctx.stroke();
        }
        const img = ctx.getImageData(0, 0, S * pr, S * pr);
        // Stretch only the flat center; the rounded caps stay fixed (true 9-slice
        // capsule). Text sits in `content`, which grows with the label.
        map.addImage(name, img, {
          pixelRatio: pr,
          stretchX: [[14 * pr, 15 * pr]],
          stretchY: [[12 * pr, 14 * pr]],
          content: [13 * pr, 7 * pr, 15 * pr, 19 * pr],
        });
      };
      const addPill = () => {
        makePill("place-pill");
        makePill("place-pill-selected", "#C2187A");
      };
      map.on("styleimagemissing", (e) => {
        if (e.id === "place-pill" || e.id === "place-pill-selected") addPill();
      });

      map.on("load", () => {
        readyRef.current = true;
        addPill();

        // Selection layers: a subtle magenta "surveyed parcel" outline for places
        // with a boundary, and a magenta marker for the selected point.
        map.addSource("selection", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "selection-fill",
          type: "fill",
          source: "selection",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#C2187A", "fill-opacity": 0.05 },
        });
        map.addLayer({
          id: "selection-outline",
          type: "line",
          source: "selection",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "line-color": "#C2187A",
            "line-width": 1.5,
            "line-dasharray": [3, 2],
          },
        });
        // Marker dot for selected places that aren't chips (POIs, custom pins);
        // chip'd places show the magenta outline pill instead. Offset upward so
        // the marker sits just above the point instead of covering the very
        // label/icon it's marking. Opacity is driven by `active` (see
        // setSelectionVisual) with a transition so switching selections fades
        // the outgoing marker out while the incoming one fades in, instead of
        // an abrupt cut or a flash of nothing selected in between.
        map.addLayer({
          id: "selection-point",
          type: "circle",
          source: "selection",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "isChip"], true]],
          paint: {
            "circle-radius": 6,
            "circle-color": "#C2187A",
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 2,
            "circle-translate": [0, -12],
            "circle-opacity": ["case", ["==", ["get", "active"], true], 1, 0],
            "circle-stroke-opacity": ["case", ["==", ["get", "active"], true], 1, 0],
            "circle-opacity-transition": { duration: 150 },
            "circle-stroke-opacity-transition": { duration: 150 },
          },
        });
        // Selected-chip highlight: a magenta pill + text drawn once, at the one
        // exact coordinate the caller supplies (the place's own stored
        // centroid — see setSelectionVisual/findChipMatches's doc comments for
        // why this is deliberately NOT derived from whatever the base map
        // happens to have rendered at a pixel right now).
        map.addLayer({
          id: "selection-chip",
          type: "symbol",
          source: "selection",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "isChip"], true]],
          layout: {
            "icon-image": "place-pill-selected",
            "icon-text-fit": "both",
            "icon-text-fit-padding": [3, 8, 3, 8],
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 13,
            "text-anchor": "center",
            "icon-allow-overlap": true,
            "text-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#C2187A",
            "icon-opacity": ["case", ["==", ["get", "active"], true], 1, 0],
            "text-opacity": ["case", ["==", ["get", "active"], true], 1, 0],
            "icon-opacity-transition": { duration: 150 },
            "text-opacity-transition": { duration: 150 },
          },
        });
      });

      // A few px of slop around the tap so labels/POIs are easy to hit.
      const TOL = 6;
      const featuresAround = (x: number, y: number) =>
        map.queryRenderedFeatures([
          [x - TOL, y - TOL],
          [x + TOL, y + TOL],
        ]);

      let longPressFired = false;

      // --- Cursor + hover affordance ---------------------------------------
      // Open hand by default, closed hand while panning, pointer over a
      // clickable label. Hovered labels turn hydrographic-blue via feature-state
      // (the style wires the color; see mapStyle.ts).
      const canvasEl = map.getCanvas();
      canvasEl.style.cursor = "grab";
      let dragging = false;
      let hovered: { sourceLayer: string; id: string | number } | null = null;

      const clearHover = () => {
        if (hovered) {
          map.setFeatureState(
            { source: "openmaptiles", sourceLayer: hovered.sourceLayer, id: hovered.id },
            { hover: false }
          );
          hovered = null;
        }
      };

      map.on("dragstart", () => {
        dragging = true;
        canvasEl.style.cursor = "grabbing";
      });
      map.on("dragend", () => {
        dragging = false;
        canvasEl.style.cursor = "grab";
      });

      // A selected place's highlight position is fixed (its own stored
      // centroid), but WHICH base-label instances need suppressing can change
      // as new tiles pan into view — re-run reconciliation on settle to catch
      // them. reconcileRef (declared below) always points at the latest
      // reconciliation closure, so this never runs stale.
      map.on("moveend", () => reconcileRef.current());

      map.on("mousemove", (e) => {
        if (dragging) return;
        const f = pickFeature(featuresAround(e.point.x, e.point.y));
        if (f && f.source === "openmaptiles" && f.sourceLayer && f.id != null) {
          if (!hovered || hovered.id !== f.id || hovered.sourceLayer !== f.sourceLayer) {
            clearHover();
            hovered = { sourceLayer: f.sourceLayer, id: f.id };
            map.setFeatureState(
              { source: "openmaptiles", sourceLayer: f.sourceLayer, id: f.id },
              { hover: true }
            );
          }
          canvasEl.style.cursor = "pointer";
        } else {
          clearHover();
          canvasEl.style.cursor = "grab";
        }
      });

      map.getCanvasContainer().addEventListener("mouseleave", () => {
        clearHover();
        if (!dragging) canvasEl.style.cursor = "grab";
      });

      // Tap → select a rendered feature.
      map.on("click", (e) => {
        if (longPressFired) {
          longPressFired = false;
          return; // this click is the tail of a long-press
        }
        const feature = pickFeature(featuresAround(e.point.x, e.point.y));
        if (!feature) return;
        // Optimistic: highlight immediately, before hydration, at this exact
        // tapped instance's own coordinates (a one-time capture — not
        // re-derived later, so it can't drift or vanish on a subsequent pan).
        const center = featureCenter(feature, e.lngLat);
        const isChip = CHIP_LAYER_IDS.includes(feature.layer.id);
        clearSuppression(map, suppressedRefs);
        if (isChip && feature.sourceLayer && feature.id != null) {
          map.setFeatureState(
            { source: "openmaptiles", sourceLayer: feature.sourceLayer, id: feature.id },
            { selected: true }
          );
          suppressedRefs.current = [{ sourceLayer: feature.sourceLayer, id: feature.id }];
        }
        setSelectionVisual(map, curVisualRef, {
          lng: center.lng,
          lat: center.lat,
          isChip,
          name: String(feature.properties!.name),
        });
        onTapFeature({
          featureId: feature.id as number,
          name: String(feature.properties!.name),
          lng: center.lng,
          lat: center.lat,
        });
      });

      // Long-press empty space → create-a-place flow. Driven off DOM pointer
      // events (not map "move", which fires from inertia and fights dragging):
      // fire after a hold with < 8px of movement, and only on empty ground.
      const canvas = map.getCanvasContainer();
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      let start: { x: number; y: number } | null = null;
      const clearTimer = () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
      };
      const onDown = (ev: PointerEvent) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        start = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        clearTimer();
        pressTimer = setTimeout(() => {
          pressTimer = null;
          if (!start) return;
          if (pickFeature(featuresAround(start.x, start.y))) return; // not empty
          const lngLat = map.unproject([start.x, start.y]);
          longPressFired = true;
          onLongPress({ lng: lngLat.lng, lat: lngLat.lat });
        }, 550);
      };
      const onMove = (ev: PointerEvent) => {
        if (!start) return;
        const rect = canvas.getBoundingClientRect();
        const dx = ev.clientX - rect.left - start.x;
        const dy = ev.clientY - rect.top - start.y;
        if (dx * dx + dy * dy > 64) clearTimer(); // moved > 8px → treat as pan
      };
      const onUp = () => {
        clearTimer();
        start = null;
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
    }

    init();
    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // initialViewProp is intentionally excluded: it's a mount-time-only value
    // (where to open, once) — including it would tear down and recreate the
    // whole WebGL map if the caller's object identity ever changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTapFeature, onLongPress]);

  // Reflect the current selection onto the map. Position is ALWAYS the
  // place's own stored centroid — never re-derived from whatever the base map
  // currently has rendered at some pixel, which is what let the highlight
  // drift, vanish on pan, or land on the wrong copy of a repeated large-
  // polygon label in the first place (see setSelectionVisual's doc comment).
  // Rendered features are still queried, but only to decide chip-vs-dot
  // treatment and to suppress the base label's own (possibly several)
  // instances while this place is selected.
  // Pulled out to a stable callback so the flyTo/moveend listeners below can
  // re-run it — once the camera actually settles after a search (destination
  // tiles may not be rendered the instant `selected` changes), and on every
  // pan/zoom (newly-panned-into-view duplicate labels need suppressing too).
  const applyChipReconciliation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getSource("selection")) return;

      if (!selected) {
        // Genuine deselect (sheet closed / hydration failed). During loading
        // we keep whatever the optimistic tap already drew.
        if (!loading) {
          clearSuppression(map, suppressedRefs);
          setSelectionVisual(map, curVisualRef, null);
        }
        return;
      }

      if (selected.osm_id == null) {
        // Custom pins etc. have no OSM identity to match against a rendered
        // label at all — always a plain dot at the stored centroid.
        clearSuppression(map, suppressedRefs);
        setSelectionVisual(map, curVisualRef, {
          lng: selected.lng,
          lat: selected.lat,
          isChip: false,
          name: selected.name,
        });
        return;
      }

      // Covers deep links and search selections, where there was no
      // optimistic tap to already know chip-vs-dot and suppress anything.
      clearSuppression(map, suppressedRefs);
      const chipMatches = findChipMatches(map, selected);
      for (const m of chipMatches) {
        if (m.sourceLayer && m.id != null) {
          map.setFeatureState({ source: "openmaptiles", sourceLayer: m.sourceLayer, id: m.id }, { selected: true });
          suppressedRefs.current.push({ sourceLayer: m.sourceLayer, id: m.id });
        }
      }
      setSelectionVisual(map, curVisualRef, {
        lng: selected.lng,
        lat: selected.lat,
        isChip: chipMatches.length > 0,
        name: selected.name,
      });
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [selected, loading]);

  useEffect(() => {
    applyChipReconciliation();
  }, [applyChipReconciliation]);

  // The flyTo effect's `idle` listener can fire well after `selected` has
  // moved on (onSearchSelect sets flyTo, then selected, in separate renders) —
  // a ref keeps the idle handler pointed at the LATEST reconciliation logic
  // instead of the stale one captured when the listener was registered.
  const reconcileRef = useRef(applyChipReconciliation);
  useEffect(() => {
    // Intentional: this ref is deliberately mutated here so the init effect's
    // moveend/idle listeners (registered once, long-lived) always call the
    // LATEST reconciliation closure instead of the stale one captured at
    // registration time — the exact "read latest state in a live listener"
    // pattern, not an accidental effect dependency mismatch.
    // eslint-disable-next-line react-hooks/immutability
    reconcileRef.current = applyChipReconciliation;
  }, [applyChipReconciliation]);

  // Search selects a place that may be off-screen; fly the camera there, then
  // re-run chip reconciliation once the camera actually arrives — the
  // destination's tiles (and its chip) may not be rendered yet the instant
  // `selected` changes. Keyed by `token` (bumped by the caller) so re-selecting
  // the same result still flies.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom });
    // "idle" (not "moveend") — moveend only means the camera animation
    // finished, but the destination's vector tiles may still be loading, so
    // queryRenderedFeatures() right then can still only see the old tiles.
    // idle fires once the render loop has nothing left to paint — but a slow
    // tile fetch can still be in flight at that exact instant, so retry once
    // more shortly after as a safety net against that race.
    map.once("idle", () => {
      reconcileRef.current();
      setTimeout(() => reconcileRef.current(), 600);
    });
    // Only re-fly on a new token — flyTo's lng/lat/zoom always change together
    // with token from the caller, so token alone is the right dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.token]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function featureCenter(feature: MapGeoJSONFeature, fallback: LngLat) {
  const g = feature.geometry;
  if (g.type === "Point") return { lng: g.coordinates[0], lat: g.coordinates[1] };
  return { lng: fallback.lng, lat: fallback.lat };
}
