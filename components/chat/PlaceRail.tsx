"use client";

import { useState } from "react";
import type { Channel, DmThread, Parent } from "@/lib/chat/types";

interface PlaceRailProps {
  channels: Channel[];
  dms: DmThread[];
  active: Parent | null;
  canPost: boolean;
  isAuthed: boolean;
  onSelectChannel: (c: Channel) => void;
  onSelectDm: (d: DmThread) => void;
  onCreateChannel: (name: string) => Promise<void>;
}

export default function PlaceRail({
  channels,
  dms,
  active,
  canPost,
  isAuthed,
  onSelectChannel,
  onSelectDm,
  onCreateChannel,
}: PlaceRailProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitChannel(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await onCreateChannel(n);
      setName("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-1">
        <SectionLabel>Channels</SectionLabel>
        {canPost && (
          <button
            onClick={() => setAdding((v) => !v)}
            aria-label="Create channel"
            className="font-mono text-sm text-contour hover:text-ink"
          >
            +
          </button>
        )}
      </div>

      <ul className="mt-1">
        {channels.map((c) => {
          const on = active?.type === "channel" && active.id === c.id;
          return (
            <li key={c.id}>
              <button
                onClick={() => onSelectChannel(c)}
                className={`flex w-full items-center gap-1.5 px-1 py-1 text-left text-sm ${
                  on ? "bg-contour/15 text-ink" : c.unread ? "text-ink" : "text-contour hover:text-ink"
                }`}
              >
                {c.unread && !on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-magenta" />}
                <span className={`truncate ${c.unread && !on ? "font-semibold" : ""}`}>
                  <span className="text-contour">#</span> {c.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {adding && (
        <form onSubmit={submitChannel} className="mt-1 px-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="new-channel"
            maxLength={40}
            className="w-full border border-contour bg-paper px-1.5 py-1 text-xs text-ink placeholder:text-contour focus:border-ink focus:outline-none"
          />
        </form>
      )}

      <div className="mt-4 px-1">
        <SectionLabel>Direct Messages</SectionLabel>
      </div>
      {isAuthed ? (
        dms.length === 0 ? (
          <p className="mt-1 px-1 text-xs text-contour">
            Reply privately to anyone who&apos;s posted here.
          </p>
        ) : (
          <ul className="mt-1">
            {dms.map((d) => {
              const on = active?.type === "dm" && active.id === d.thread_id;
              return (
                <li key={d.thread_id}>
                  <button
                    onClick={() => onSelectDm(d)}
                    className={`flex w-full items-center gap-1.5 px-1 py-1 text-left text-sm ${
                      on ? "bg-contour/15 text-ink" : d.unread ? "text-ink" : "text-contour hover:text-ink"
                    }`}
                  >
                    {d.unread && !on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-magenta" />}
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full border border-contour`} />
                    <span className={`truncate ${d.unread && !on ? "font-semibold" : ""}`}>
                      {d.other_handle ? `@${d.other_handle}` : "someone"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <p className="mt-1 px-1 text-xs text-contour">Sign in to send direct messages.</p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-contour">{children}</div>
  );
}
