"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat/types";
import MessageRow from "./MessageRow";
import MessageList from "./MessageList";
import Composer from "./Composer";

interface ThreadPanelProps {
  root: ChatMessage;
  replies: ChatMessage[] | undefined;
  userId: string | null;
  canPost: boolean;
  isAuthed: boolean;
  onClose: () => void;
  onSend: (body: string) => Promise<void>;
  onReact: (id: string, emoji: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string, threadRootId?: string | null) => void;
}

export default function ThreadPanel({
  root,
  replies,
  userId,
  canPost,
  isAuthed,
  onClose,
  onSend,
  onReact,
  onEdit,
  onDelete,
}: ThreadPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-contour pb-2">
        <button onClick={onClose} aria-label="Close thread" className="font-mono text-sm text-contour hover:text-ink">
          ←
        </button>
        <span className="text-sm font-semibold text-ink">Thread</span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="py-2">
          <MessageRow
            message={root}
            startGroup
            isOwn={root.author_id === userId}
            canPost={canPost}
            context="thread"
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-contour">
            {root.reply_count ?? replies?.length ?? 0} {(root.reply_count ?? 0) === 1 ? "reply" : "replies"}
          </span>
          <span className="h-px flex-1 bg-contour" />
        </div>

        {!replies ? (
          <p className="px-1 py-3 text-xs text-contour">Loading replies…</p>
        ) : replies.length === 0 ? (
          <p className="px-1 py-3 text-sm text-contour">No replies yet — start the thread.</p>
        ) : (
          <MessageList
            messages={replies}
            userId={userId}
            canPost={canPost}
            context="thread"
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>

      <Composer canPost={canPost} isAuthed={isAuthed} placeholder="Reply…" autoFocus onSend={onSend} />
    </div>
  );
}
