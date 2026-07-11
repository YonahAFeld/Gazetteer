"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "gazetteer:intro-dismissed";

interface FirstVisitHintProps {
  /** Flip to true once the user has done the thing this hint teaches. */
  dismissTrigger: boolean;
}

/**
 * One-time contextual nudge toward the core interaction (tap a place). Shown
 * once per browser, dismissible, and auto-clears the moment the user actually
 * selects something — never a modal wall, never reappears once dismissed.
 */
export default function FirstVisitHint({ dismissTrigger }: FirstVisitHintProps) {
  // MapView only ever mounts this client-only (ssr:false), so `window` is
  // always available here — a lazy initializer avoids a setState-in-effect.
  const [visible, setVisible] = useState(() => {
    try {
      return !window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return false; // localStorage unavailable (private mode, disabled storage)
    }
  });

  useEffect(() => {
    if (dismissTrigger) dismiss();
  }, [dismissTrigger]);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* best-effort — worst case the hint reappears next visit */
    }
  }

  if (!visible) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-32 z-10 w-[92%] max-w-sm -translate-x-1/2 font-sans md:top-20">
      <div className="flex items-start gap-2 border border-ink bg-paper p-2.5 shadow-[2px_2px_0_0_var(--ink)]">
        <p className="text-sm text-ink">
          Tap any place on the map — a café, a park, a neighborhood — to join its channels.
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mt-0.5 shrink-0 font-mono text-sm text-contour hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
