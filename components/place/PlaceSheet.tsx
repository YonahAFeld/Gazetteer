"use client";

import { useEffect, useState } from "react";
import { type Place, kindLabel, formatCoords } from "@/lib/geo/types";
import PlaceWorkspace from "@/components/chat/PlaceWorkspace";

export interface PendingPin {
  lng: number;
  lat: number;
}

interface PlaceSheetProps {
  place: Place | null;
  /** Channel slug from a deep link or a popstate navigation, if any. */
  channelSlug?: string | null;
  pendingPin: PendingPin | null;
  loading: boolean;
  isAuthed: boolean;
  onClose: () => void;
  onCreatePin: (name: string, pin: PendingPin) => Promise<void>;
}

export default function PlaceSheet({
  place,
  channelSlug,
  pendingPin,
  loading,
  isAuthed,
  onClose,
  onCreatePin,
}: PlaceSheetProps) {
  const open = loading || place !== null || pendingPin !== null;

  // Esc closes the sheet (SPEC.md §5).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[75%] border-t border-ink bg-paper md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-150 md:border-l md:border-t-0"
      role="dialog"
      aria-label="Place details"
    >
      <div className="flex h-full flex-col p-5">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 font-mono text-sm text-contour hover:text-ink"
        >
          ✕
        </button>

        {loading && <SheetSkeleton />}

        {!loading && pendingPin && (
          <PinForm pin={pendingPin} isAuthed={isAuthed} onCreatePin={onCreatePin} />
        )}

        {!loading && !pendingPin && place && <PlaceDetail place={place} channelSlug={channelSlug} />}
      </div>
    </div>
  );
}

function KindLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-contour">
      {children}
    </div>
  );
}

function PlaceDetail({ place, channelSlug }: { place: Place; channelSlug?: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pr-8">
        <KindLabel>{kindLabel(place.kind)}</KindLabel>
        <h1 className="mt-1 font-display text-4xl italic leading-tight text-ink">{place.name}</h1>
        <p className="mt-2 font-mono text-[11px] text-contour">
          {formatCoords(place.lat, place.lng)}
        </p>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-contour pt-2">
        <PlaceWorkspace
          key={place.id}
          placeId={place.id}
          placeName={place.name}
          initialChannelSlug={channelSlug}
        />
      </div>
    </div>
  );
}

function PinForm({
  pin,
  isAuthed,
  onCreatePin,
}: {
  pin: PendingPin;
  isAuthed: boolean;
  onCreatePin: (name: string, pin: PendingPin) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onCreatePin(name.trim(), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the place.");
      setSaving(false);
    }
  }

  return (
    <div className="pr-8">
      <KindLabel>New Place</KindLabel>
      <p className="mt-2 font-mono text-xs text-contour">{formatCoords(pin.lat, pin.lng)}</p>

      {isAuthed ? (
        <form onSubmit={submit} className="mt-4 space-y-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this place"
            maxLength={120}
            className="w-full border border-contour bg-paper px-2 py-2 font-display text-lg italic text-ink placeholder:font-sans placeholder:text-base placeholder:not-italic placeholder:text-contour focus:border-ink focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full bg-magenta px-3 py-2 text-xs font-medium uppercase tracking-widest text-paper disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create place here"}
          </button>
          {error && <p className="text-xs text-magenta">{error}</p>}
        </form>
      ) : (
        <p className="mt-4 text-sm text-ink">
          Sign in to create a place here. Use the control in the top-right corner.
        </p>
      )}
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="animate-pulse pr-8">
      <div className="h-3 w-24 bg-contour/40" />
      {/* Wide, not proportional — place names range from "LA" to "Topanga State
          Park" to much longer, and under-promising here made the real title
          visibly grow past the skeleton the instant it loaded. */}
      <div className="mt-2 h-10 w-11/12 bg-contour/40" />
      {/* Coordinates are a fixed-format string ("34.0521° N 118.4741° W"),
          not proportional to the place name — a fixed width matches better. */}
      <div className="mt-5 h-3 w-40 bg-contour/30" />
    </div>
  );
}
