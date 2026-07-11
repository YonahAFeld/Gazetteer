"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapCanvas, { type TapTarget, type FlyToTarget } from "./MapCanvas";
import PlaceSheet, { type PendingPin } from "@/components/place/PlaceSheet";
import InfoControl from "@/components/onboarding/InfoControl";
import FirstVisitHint from "@/components/onboarding/FirstVisitHint";
import SearchBar from "@/components/search/SearchBar";
import { createClient } from "@/lib/supabase/client";
import { zoomForKind, type Place } from "@/lib/geo/types";
import type { SearchResult } from "@/app/api/geo/search/route";

interface PlaceRow {
  id: string;
  osm_type: string | null;
  osm_id: number | null;
  kind: string;
  name: string;
  admin_level: number | null;
  lng: number;
  lat: number;
  has_boundary: boolean;
}

function rowToPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    osm_type: row.osm_type,
    osm_id: row.osm_id,
    kind: row.kind,
    name: row.name,
    admin_level: row.admin_level,
    lng: row.lng,
    lat: row.lat,
    hasBoundary: row.has_boundary,
  };
}

const DEEP_LINK_RE = /^\/p\/([^/]+)(?:\/([^/]+))?\/?$/;

interface MapViewProps {
  /** Seeded from the server when this mounts under a `/p/[placeId]` route. */
  initialPlace?: Place | null;
  initialChannelSlug?: string | null;
}

/**
 * Stateful map surface: owns the current selection and drives the place sheet.
 * A tap hydrates the feature server-side (§4); a long-press starts a custom-pin
 * flow. The map stays live behind the sheet (§5).
 *
 * Also owns the shareable-link URL: `/p/[placeId]/[channelSlug]`. Updated via
 * raw `history.pushState` (never Next's router — that would re-run the route's
 * server data fetch and remount this whole client tree, tearing down the live
 * MapLibre canvas on every channel switch), so back/forward is handled by hand
 * via a `popstate` listener rather than Next's router.
 */
export default function MapView({ initialPlace = null, initialChannelSlug = null }: MapViewProps) {
  const [selected, setSelected] = useState<Place | null>(initialPlace);
  const [channelSlug, setChannelSlug] = useState<string | null>(initialChannelSlug);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [flyTo, setFlyTo] = useState<FlyToTarget | null>(null);
  const [supabase] = useState(() => createClient());
  const hydrateSeq = useRef(0);
  const flyToken = useRef(0);

  // Deep-link entry: open already centered on the place, not geolocated.
  const initialView = initialPlace
    ? { lng: initialPlace.lng, lat: initialPlace.lat, zoom: zoomForKind(initialPlace.kind) }
    : null;

  // Track auth so the long-press flow can gate on it (SPEC.md §5).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsAuthed(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setIsAuthed(!!session?.user)
    );
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // Browser back/forward: we bypass Next's router for pushState (see above),
  // so we're responsible for reacting to it ourselves.
  useEffect(() => {
    const onPopState = async () => {
      const match = window.location.pathname.match(DEEP_LINK_RE);
      if (!match) {
        hydrateSeq.current++;
        setSelected(null);
        setPendingPin(null);
        setChannelSlug(null);
        return;
      }
      const [, id, slug] = match;
      const seq = ++hydrateSeq.current;
      setPendingPin(null);
      const { data } = await supabase.rpc("place_by_id", { p_id: id });
      if (seq !== hydrateSeq.current) return;
      const row = (data as PlaceRow[] | null)?.[0];
      const place = row ? rowToPlace(row) : null;
      setSelected(place);
      setChannelSlug(slug ?? null);
      if (place) {
        setFlyTo({ lng: place.lng, lat: place.lat, zoom: zoomForKind(place.kind), token: ++flyToken.current });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [supabase]);

  const onTapFeature = useCallback(async (target: TapTarget) => {
    const seq = ++hydrateSeq.current;
    setPendingPin(null);
    setSelected(null);
    setLoading(true);
    try {
      const res = await fetch("/api/geo/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (seq !== hydrateSeq.current) return; // superseded by a newer tap
      if (res.ok) {
        const { place } = (await res.json()) as { place: Place };
        setSelected(place);
        setChannelSlug(null);
        window.history.pushState(null, "", `/p/${place.id}`);
      } else {
        setSelected(null);
      }
    } catch {
      if (seq === hydrateSeq.current) setSelected(null);
    } finally {
      if (seq === hydrateSeq.current) setLoading(false);
    }
  }, []);

  const onSearchSelect = useCallback(async (result: SearchResult) => {
    const seq = ++hydrateSeq.current;
    setPendingPin(null);
    setSelected(null);
    setLoading(true);
    setFlyTo({ lng: result.lng, lat: result.lat, zoom: result.zoom, token: ++flyToken.current });
    try {
      const res = await fetch("/api/geo/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osmId: result.osmId, name: result.name, lng: result.lng, lat: result.lat }),
      });
      if (seq !== hydrateSeq.current) return;
      if (res.ok) {
        const { place } = (await res.json()) as { place: Place };
        setSelected(place);
        setChannelSlug(null);
        window.history.pushState(null, "", `/p/${place.id}`);
      } else {
        setSelected(null);
      }
    } catch {
      if (seq === hydrateSeq.current) setSelected(null);
    } finally {
      if (seq === hydrateSeq.current) setLoading(false);
    }
  }, []);

  const onLongPress = useCallback((lngLat: { lng: number; lat: number }) => {
    hydrateSeq.current++; // cancel any in-flight tap
    setLoading(false);
    setSelected(null);
    setPendingPin({ lng: lngLat.lng, lat: lngLat.lat });
  }, []);

  const onCreatePin = useCallback(async (name: string, pin: PendingPin) => {
    const res = await fetch("/api/geo/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lng: pin.lng, lat: pin.lat }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: "create_failed" }))) as {
        error?: string;
      };
      throw new Error(
        error === "unauthenticated" ? "Please sign in first." : "Could not create the place."
      );
    }
    const { place } = (await res.json()) as { place: Place };
    setPendingPin(null);
    setSelected(place);
    setChannelSlug(null);
    window.history.pushState(null, "", `/p/${place.id}`);
  }, []);

  const onClose = useCallback(() => {
    hydrateSeq.current++;
    setSelected(null);
    setPendingPin(null);
    setChannelSlug(null);
    setLoading(false);
    window.history.pushState(null, "", "/");
  }, []);

  return (
    <>
      <MapCanvas
        selected={selected}
        loading={loading}
        onTapFeature={onTapFeature}
        onLongPress={onLongPress}
        flyTo={flyTo}
        initialView={initialView}
      />
      <SearchBar onSelect={onSearchSelect} />
      <PlaceSheet
        place={selected}
        channelSlug={channelSlug}
        pendingPin={pendingPin}
        loading={loading}
        isAuthed={isAuthed}
        onClose={onClose}
        onCreatePin={onCreatePin}
      />
      <InfoControl />
      <FirstVisitHint dismissTrigger={selected !== null || pendingPin !== null} />
    </>
  );
}
