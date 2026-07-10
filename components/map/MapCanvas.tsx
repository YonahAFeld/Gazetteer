"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type StyleSpecification,
  type MapGeoJSONFeature,
  type LngLat,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { surveyStyle } from "./mapStyle";
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
  onTapFeature: (target: TapTarget) => void;
  onLongPress: (lngLat: { lng: number; lat: number }) => void;
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

export default function MapCanvas({ selected, onTapFeature, onLongPress }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);

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

      map.on("load", () => {
        readyRef.current = true;

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
        map.addLayer({
          id: "selection-point",
          type: "circle",
          source: "selection",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#C2187A",
            "circle-stroke-color": "#F7F5EF",
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

  // Reflect the current selection onto the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("selection") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: "FeatureCollection",
        features: selected
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [selected.lng, selected.lat] },
                properties: {},
              },
            ]
          : [],
      });
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [selected]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function featureCenter(feature: MapGeoJSONFeature, fallback: LngLat) {
  const g = feature.geometry;
  if (g.type === "Point") return { lng: g.coordinates[0], lat: g.coordinates[1] };
  return { lng: fallback.lng, lat: fallback.lat };
}
