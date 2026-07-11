"use client";

import { useState } from "react";

interface ShareChannelButtonProps {
  placeId: string;
  channelSlug: string;
}

/** Copies a plain, trackingless link to this exact channel. No invite
 * mechanic — the URL is identical to whatever the address bar already shows. */
export default function ShareChannelButton({ placeId, channelSlug }: ShareChannelButtonProps) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/p/${placeId}/${channelSlug}` : "";

  async function onClick() {
    if (!navigator.clipboard?.writeText) {
      setShowFallback((v) => !v);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShowFallback(true);
    }
  }

  return (
    <div className="relative ml-auto shrink-0">
      <button
        onClick={onClick}
        aria-label="Copy link to this channel"
        className="flex items-center gap-1 border border-ink px-1.5 py-1 font-mono text-[10px] uppercase tracking-widest text-ink hover:border-2"
      >
        <ShareIcon className="h-3 w-3" />
        {copied ? "Copied" : "Copy link"}
      </button>
      {showFallback && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 border border-ink bg-paper p-2 shadow-[2px_2px_0_0_var(--ink)]">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full bg-paper font-mono text-xs text-ink focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

function ShareIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
