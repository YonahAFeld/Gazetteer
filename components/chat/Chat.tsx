"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/lib/chat/useChat";
import type { ChatMessage } from "@/lib/chat/types";

interface ChatProps {
  placeId: string;
  placeName: string;
}

export default function Chat({ placeId, placeName }: ChatProps) {
  const { messages, loading, userId, canPost, isAuthed, send, deleteMessage } = useChat(placeId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState placeName={placeName} />
        ) : (
          <MessageList messages={messages} userId={userId} onDelete={deleteMessage} />
        )}
      </div>
      <Composer canPost={canPost} isAuthed={isAuthed} onSend={send} />
    </div>
  );
}

// --- Message list --------------------------------------------------------

const FIVE_MIN = 5 * 60 * 1000;

function MessageList({
  messages,
  userId,
  onDelete,
}: {
  messages: ChatMessage[];
  userId: string | null;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className="space-y-0.5 py-2">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || !sameDay(prev.created_at, m.created_at);
        const startGroup =
          newDay ||
          prev.author_id !== m.author_id ||
          new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > FIVE_MIN;
        return (
          <li key={m.id}>
            {newDay && <DayDivider iso={m.created_at} />}
            <MessageRow
              message={m}
              startGroup={startGroup}
              isOwn={m.author_id === userId}
              onDelete={onDelete}
            />
          </li>
        );
      })}
    </ul>
  );
}

function MessageRow({
  message,
  startGroup,
  isOwn,
  onDelete,
}: {
  message: ChatMessage;
  startGroup: boolean;
  isOwn: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`group px-1 ${startGroup ? "mt-2" : ""} ${
        isOwn ? "border-l-2 border-magenta pl-2" : "pl-[10px]"
      }`}
    >
      {startGroup && (
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${isOwn ? "text-magenta" : "text-ink"}`}>
            {message.handle ? `@${message.handle}` : "…"}
          </span>
          <span className="font-mono text-[10px] text-contour">{formatTime(message.created_at)}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <p
          className={`whitespace-pre-wrap break-words text-sm text-ink ${
            message.pending ? "opacity-50" : ""
          }`}
        >
          {message.body}
        </p>
        {isOwn && !message.pending && (
          <button
            onClick={() => onDelete(message.id)}
            aria-label="Delete message"
            className="mt-0.5 shrink-0 font-mono text-xs text-contour opacity-0 transition-opacity hover:text-magenta group-hover:opacity-100"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-2">
      <span className="h-px flex-1 bg-contour" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-contour">
        {formatDay(iso)}
      </span>
      <span className="h-px flex-1 bg-contour" />
    </div>
  );
}

function EmptyState({ placeName }: { placeName: string }) {
  return (
    <div className="flex h-full items-center px-1 py-8">
      <p className="text-sm text-contour">
        No one has said anything in <span className="text-ink">{placeName}</span> yet.
      </p>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="animate-pulse space-y-3 py-3">
      {[70, 45, 60].map((w, i) => (
        <div key={i} className="space-y-1">
          <div className="h-3 w-20 bg-contour/40" />
          <div className="h-3 bg-contour/30" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

// --- Composer ------------------------------------------------------------

function Composer({
  canPost,
  isAuthed,
  onSend,
}: {
  canPost: boolean;
  isAuthed: boolean;
  onSend: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  if (!canPost) {
    return (
      <div className="border-t border-contour pt-3 text-sm text-contour">
        {isAuthed ? (
          <>Claim a handle (top-right) to talk here.</>
        ) : (
          <>Sign in (top-right) to talk here.</>
        )}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    setText("");
    try {
      await onSend(body);
    } catch (err) {
      setText(body);
      const code = (err as { code?: string; message?: string })?.code;
      const msg = (err as { message?: string })?.message ?? "";
      setError(code === "P0001" || /rate_limited/.test(msg) ? "Slow down a moment." : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-contour pt-3">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Say something…"
          className="max-h-28 min-h-[2.25rem] w-full resize-none border border-contour bg-paper px-2 py-2 text-sm text-ink placeholder:text-contour focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="h-[2.25rem] shrink-0 bg-magenta px-3 text-xs font-medium uppercase tracking-widest text-paper disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-magenta">{error}</p>}
    </form>
  );
}

// --- formatting ----------------------------------------------------------

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(iso, today.toISOString())) return "Today";
  if (sameDay(iso, yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
