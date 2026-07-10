"use client";

import { useState } from "react";
import { QUICK_EMOJI, MORE_EMOJI } from "@/lib/chat/types";

/** Compact picker: the six-emoji quick set, expandable to a small grid. No
 * search (that's a fast-follow). */
export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-ink bg-paper p-1 shadow-[3px_3px_0_rgba(26,26,24,0.15)]">
      <div className="flex gap-0.5">
        {QUICK_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="flex h-7 w-7 items-center justify-center text-base hover:bg-contour/20"
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label="More emoji"
          className="flex h-7 w-7 items-center justify-center font-mono text-xs text-contour hover:text-ink"
        >
          {expanded ? "–" : "+"}
        </button>
      </div>
      {expanded && (
        <div className="mt-1 grid max-w-[220px] grid-cols-8 gap-0.5 border-t border-contour pt-1">
          {MORE_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="flex h-7 w-7 items-center justify-center text-base hover:bg-contour/20"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
