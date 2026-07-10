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

// Layers whose features represent selectable places (POIs and area labels).
const SELECTABLE_LAYER_RE = /poi|place|boundary|park|water_name|mountain_peak|aerodrome/i;

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
      SELECTABLE_LAYER_RE.test(f.layer.id) &&
      typeof f.properties?.name === "string"
  );
  if (named.length === 0) return null;
  // Prefer POIs/labels (points) over large area fills when both are hit.
  named.sort((a, b) => {
    const rank = (f: MapGeoJSONFeature) => (/poi|_name|place/i.test(f.layer.id) ? 0 : 1);
    return rank(a) - rank(b);
  });
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

      // Tap → select a rendered feature.
      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point);
        const feature = pickFeature(features);
        if (!feature) return;
        const center = featureCenter(feature, e.lngLat);
        onTapFeature({
          featureId: feature.id as number,
          name: String(feature.properties!.name),
          lng: center.lng,
          lat: center.lat,
        });
      });

      // Long-press empty space → create-a-place flow.
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      let pressStart: LngLat | null = null;
      const startPress = (lngLat: LngLat) => {
        pressStart = lngLat;
        pressTimer = setTimeout(() => {
          if (pressStart) onLongPress({ lng: pressStart.lng, lat: pressStart.lat });
        }, 550);
      };
      const cancelPress = () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
        pressStart = null;
      };
      map.on("mousedown", (e) => startPress(e.lngLat));
      map.on("touchstart", (e) => startPress(e.lngLat));
      map.on("mouseup", cancelPress);
      map.on("touchend", cancelPress);
      map.on("dragstart", cancelPress);
      map.on("move", cancelPress);
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
