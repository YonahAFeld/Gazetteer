"use client";

import { useEffect, useRef } from "react";
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

interface MapCanvasProps {
  selected: Place | null;
  loading: boolean;
  onTapFeature: (target: TapTarget) => void;
  onLongPress: (lngLat: { lng: number; lat: number }) => void;
}

type FeatureRef = { source: string; sourceLayer: string; id: string | number };

/** Move the `selected` feature-state from the previous feature to `next`. */
function moveSelectedState(
  map: MapLibreMap,
  ref: { current: FeatureRef | null },
  next: FeatureRef | null
) {
  if (ref.current) {
    map.setFeatureState(ref.current, { selected: false });
    ref.current = null;
  }
  if (next) {
    map.setFeatureState(next, { selected: true });
    ref.current = next;
  }
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

export default function MapCanvas({
  selected,
  loading,
  onTapFeature,
  onLongPress,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const selectedFeatRef = useRef<{ source: string; sourceLayer: string; id: string | number } | null>(
    null
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    async function init() {
      let style: StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        if (res.ok) style = surveyStyle((await res.json()) as StyleSpecification);
      } catch {
        /* fall back to the raw URL so the map still renders */
      }
      if (cancelled || !container) return;

      const map = new maplibregl.Map({
        container,
        style,
        center: [0, 20],
        zoom: 2,
        attributionControl: { compact: true },
        minZoom: 1,
        maxZoom: 19,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.GeolocateControl({}), "bottom-right");
      mapRef.current = map;

      // Stretchable capsule chip drawn behind clickable place labels
      // (mapStyle.ts references "place-pill" / "place-pill-selected" via
      // icon-text-fit). `border` gives the selected variant its magenta outline.
      const pr = 2;
      const S = 28; // logical canvas size; the rect is inset to leave shadow room
      // `border` draws the selected variant's magenta outline with a transparent
      // center, so it overlays the base pill without hiding the label text.
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
        if (border) {
          // Outline only (base pill provides the white fill + shadow underneath).
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = border;
          ctx.stroke();
        } else {
          // White capsule with a soft drop shadow, Airbnb-price-pill style.
          ctx.shadowColor = "rgba(26,26,24,0.28)";
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 1.5;
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
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
        // chip'd places show the magenta outline pill instead.
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
        // Optimistic: highlight the tapped chip immediately, before hydration.
        if (feature.source && feature.sourceLayer && feature.id != null) {
          moveSelectedState(map, selectedFeatRef, {
            source: feature.source,
            sourceLayer: feature.sourceLayer,
            id: feature.id,
          });
        }
        const center = featureCenter(feature, e.lngLat);
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
  }, [onTapFeature, onLongPress]);

  // Reflect the current selection onto the map: the magenta `selected`
  // feature-state on the tapped place's chip (→ magenta outline + text), and a
  // fallback dot marker for selected places that have no chip (POIs, custom pins).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const src = map.getSource("selection") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;

      let onChip = false;
      if (selected && selected.osm_id != null) {
        // Reconcile the chip highlight against the resolved place (also covers
        // deep links, where there was no optimistic tap to set it).
        const matches = map
          .queryRenderedFeatures()
          .filter(
            (f) =>
              f.id != null &&
              SELECTABLE_SOURCE_LAYERS.has(f.sourceLayer ?? "") &&
              Math.floor(Number(f.id) / 10) === selected.osm_id
          );
        const first = matches[0];
        if (first?.sourceLayer && first.id != null) {
          moveSelectedState(map, selectedFeatRef, {
            source: "openmaptiles",
            sourceLayer: first.sourceLayer,
            id: first.id,
          });
        }
        onChip = matches.some((m) =>
          CHIP_LAYER_IDS.includes(m.layer.id.replace(/__selected$/, ""))
        );
      } else if (!selected && !loading) {
        // Genuine deselect (sheet closed / hydration failed) — clear. During
        // loading we keep the optimistic highlight set on tap.
        moveSelectedState(map, selectedFeatRef, null);
      }

      // Dot marker for selected places with no chip (POIs, custom pins).
      src.setData({
        type: "FeatureCollection",
        features: selected
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [selected.lng, selected.lat] },
                properties: { isChip: onChip },
              },
            ]
          : [],
      });
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [selected, loading]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function featureCenter(feature: MapGeoJSONFeature, fallback: LngLat) {
  const g = feature.geometry;
  if (g.type === "Point") return { lng: g.coordinates[0], lat: g.coordinates[1] };
  return { lng: fallback.lng, lat: fallback.lat };
}
