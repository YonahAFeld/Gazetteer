"use client";

import dynamic from "next/dynamic";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
});

export default function MapLoader() {
  return <MapCanvas />;
}
