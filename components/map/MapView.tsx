"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapCanvas, { type TapTarget } from "./MapCanvas";
import PlaceSheet, { type PendingPin } from "@/components/place/PlaceSheet";
import { createClient } from "@/lib/supabase/client";
import type { Place } from "@/lib/geo/types";

/**
 * Stateful map surface: owns the current selection and drives the place sheet.
 * A tap hydrates the feature server-side (§4); a long-press starts a custom-pin
 * flow. The map stays live behind the sheet (§5).
 */
export default function MapView() {
  const [selected, setSelected] = useState<Place | null>(null);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const hydrateSeq = useRef(0);

  // Track auth so the long-press flow can gate on it (SPEC.md §5).
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsAuthed(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setIsAuthed(!!session?.user)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

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
  }, []);

  const onClose = useCallback(() => {
    hydrateSeq.current++;
    setSelected(null);
    setPendingPin(null);
    setLoading(false);
  }, []);

  return (
    <>
      <MapCanvas
        selected={selected}
        loading={loading}
        onTapFeature={onTapFeature}
        onLongPress={onLongPress}
      />
      <PlaceSheet
        place={selected}
        pendingPin={pendingPin}
        loading={loading}
        isAuthed={isAuthed}
        onClose={onClose}
        onCreatePin={onCreatePin}
      />
    </>
  );
}
