"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/chat/types";
import EmojiPicker from "./EmojiPicker";

interface MessageRowProps {
  message: ChatMessage;
  startGroup: boolean;
  isOwn: boolean;
  canPost: boolean;
  context: "stream" | "thread";
  onReact: (id: string, emoji: string) => void;
  onReply?: (id: string) => void;
  onOpenThread?: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string, threadRootId?: string | null) => void;
  onMessageUser?: (authorId: string) => void;
}

export default function MessageRow({
  message,
  startGroup,
  isOwn,
  canPost,
  context,
  onReact,
  onReply,
  onOpenThread,
  onEdit,
  onDelete,
  onMessageUser,
}: MessageRowProps) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const reactions = message.reactions ?? [];
  const replyCount = context === "stream" ? message.reply_count ?? 0 : 0;

  function saveEdit() {
    const text = draft.trim();
    if (text && text !== message.body) onEdit(message.id, text);
    setEditing(false);
  }

  return (
    <div
      className={`group relative px-1 ${startGroup ? "mt-2" : ""} ${
        isOwn ? "border-l-2 border-magenta pl-2" : "pl-2.5"
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

      {editing ? (
        <div className="mt-0.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            rows={1}
            maxLength={2000}
            className="max-h-28 min-h-8 w-full resize-none border border-contour bg-paper px-2 py-1 text-sm text-ink focus:border-ink focus:outline-none"
          />
          <div className="mt-1 flex gap-2 font-mono text-[10px] text-contour">
            <button onClick={saveEdit} className="hover:text-magenta">
              save
            </button>
            <button onClick={() => setEditing(false)} className="hover:text-ink">
              cancel
            </button>
          </div>
        </div>
      ) : (
        <p
          className={`whitespace-pre-wrap wrap-break-word text-sm text-ink ${
            message.pending ? "opacity-50" : ""
          }`}
        >
          {message.body}
          {message.edited_at && <span className="ml-1 text-[10px] text-contour">(edited)</span>}
        </p>
      )}

      {/* Reaction chips */}
      {reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              disabled={!canPost}
              onClick={() => onReact(message.id, r.emoji)}
              className={`flex items-center gap-1 border px-1.5 py-0.5 text-xs leading-none disabled:cursor-default ${
                r.mine ? "border-magenta text-magenta" : "border-contour text-contour hover:border-ink"
              }`}
            >
              <span className="text-sm">{r.emoji}</span>
              <span className="font-mono">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Thread collapse line — the only inline trace of a thread */}
      {replyCount > 0 && (
        <button
          type="button"
          onClick={() => onOpenThread?.(message.id)}
          className="mt-1 block font-mono text-[11px] text-magenta hover:underline"
        >
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
          {message.last_reply_at ? ` · ${formatRelative(message.last_reply_at)}` : ""}
        </button>
      )}

      {/* Action toolbar — kept subtly visible (no reliable hover on touch) */}
      {!editing && !message.pending && (
        <div className="absolute right-1 top-0 flex items-center gap-2 font-mono text-[11px] text-contour/60">
          {canPost && (
            <button onClick={() => setPicking((v) => !v)} aria-label="React" className="hover:text-magenta">
              ☺
            </button>
          )}
          {canPost && context === "stream" && onReply && (
            <button onClick={() => onReply(message.id)} aria-label="Reply in thread" className="hover:text-ink">
              ↳
            </button>
          )}
          {!isOwn && onMessageUser && (
            <button
              onClick={() => onMessageUser(message.author_id)}
              aria-label="Message this person"
              className="hover:text-ink"
            >
              DM
            </button>
          )}
          {isOwn && (
            <button onClick={() => setEditing(true)} aria-label="Edit" className="hover:text-ink">
              edit
            </button>
          )}
          {isOwn && (
            <button
              onClick={() => onDelete(message.id, message.thread_root_id)}
              aria-label="Delete"
              className="hover:text-magenta"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {picking && (
        <div className="absolute right-1 top-5 z-20">
          <EmojiPicker
            onPick={(e) => {
              onReact(message.id, e);
              setPicking(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
