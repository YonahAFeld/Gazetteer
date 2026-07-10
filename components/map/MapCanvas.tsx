"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { surveyStyle } from "./mapStyle";

// OpenFreeMap Liberty is the default base. The architecture keeps this a single
// swappable constant so a self-hosted Protomaps PMTiles style can replace it later.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    async function init() {
      // Fetch Liberty once, recolor to "The Survey", pass the object so there is
      // no flash of the original full-color style.
      let style: StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        if (res.ok) {
          style = surveyStyle((await res.json()) as StyleSpecification);
        }
      } catch {
        // Network hiccup: fall back to the raw URL so the map still renders.
      }
      if (cancelled || !container) return;

      const map = new maplibregl.Map({
        container,
        style,
        center: [0, 20],
        zoom: 2,
        attributionControl: { compact: true },
        // Room to zoom from planet down to a street.
        minZoom: 1,
        maxZoom: 19,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.GeolocateControl({}), "bottom-right");
      mapRef.current = map;
    }

    init();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
