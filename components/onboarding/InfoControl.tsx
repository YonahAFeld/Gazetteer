"use client";

import { useEffect, useState } from "react";

/**
 * Persistent "what is this" affordance — bottom-left, mirroring AccountControl's
 * top-right corner. Always available, never blocks the map (no modal wall).
 */
export default function InfoControl() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 font-sans">
      {open ? (
        <AboutPanel onClose={() => setOpen(false)} />
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="What is Gazetteer?"
          className="flex h-8 w-8 items-center justify-center border border-ink bg-paper text-sm font-medium text-ink transition-[border-width] hover:border-2"
        >
          ?
        </button>
      )}
    </div>
  );
}

function KindLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-contour">
      {children}
    </div>
  );
}

function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="w-72 border border-ink bg-paper p-3 shadow-[2px_2px_0_0_var(--ink)]">
      <div className="mb-1 flex items-start justify-between">
        <KindLabel>About</KindLabel>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 font-mono text-sm text-contour hover:text-ink"
        >
          ✕
        </button>
      </div>

      <h2 className="font-display text-2xl italic leading-tight text-ink">Gazetteer</h2>
      <p className="mt-1 text-sm text-ink">Open source. Channels for every place.</p>

      <div className="mt-3 border-t border-contour pt-2">
        <KindLabel>How it works</KindLabel>
        <ul className="space-y-1.5 text-sm text-ink">
          <li className="flex gap-2">
            <span className="shrink-0 text-contour">–</span>
            <span>Pan, zoom and search like any map.</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 text-contour">–</span>
            <span>Select a place to open its channels.</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 text-contour">–</span>
            <span>Sign in to post. Reading is open to everyone.</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 text-contour">–</span>
            <span>Long-press empty ground to create your own place.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
