"use client";

import dynamic from "next/dynamic";
import type { Place } from "@/lib/geo/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
});

interface MapLoaderProps {
  initialPlace?: Place | null;
  initialChannelSlug?: string | null;
}

export default function MapLoader({ initialPlace, initialChannelSlug }: MapLoaderProps) {
  return <MapView initialPlace={initialPlace} initialChannelSlug={initialChannelSlug} />;
}
