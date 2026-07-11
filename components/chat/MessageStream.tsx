"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, Parent } from "@/lib/chat/types";
import MessageList from "./MessageList";
import Composer from "./Composer";

interface MessageStreamProps {
  parent: Parent;
  messages: ChatMessage[];
  loading: boolean;
  userId: string | null;
  canPost: boolean;
  isAuthed: boolean;
  memberCount?: number;
  initialComposerText?: string;
  onBack: () => void;
  onSend: (body: string) => Promise<void>;
  onReact: (id: string, emoji: string) => void;
  onReply: (id: string) => void;
  onOpenThread: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string, threadRootId?: string | null) => void;
  onMessageUser: (authorId: string, message: ChatMessage) => void;
}

export default function MessageStream({
  parent,
  messages,
  loading,
  userId,
  canPost,
  isAuthed,
  memberCount,
  initialComposerText,
  onBack,
  onSend,
  onReact,
  onReply,
  onOpenThread,
  onEdit,
  onDelete,
  onMessageUser,
}: MessageStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const title = parent.type === "channel" ? `# ${parent.name}` : `@${parent.name}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-contour pb-2">
        <button onClick={onBack} aria-label="Back to channels" className="font-mono text-sm text-contour hover:text-ink md:hidden">
          ←
        </button>
        <span className="truncate text-sm font-semibold text-ink">{title}</span>
        {parent.type === "channel" && memberCount != null && memberCount > 0 && (
          <span className="font-mono text-[10px] text-contour">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <EmptyStream parent={parent} />
        ) : (
          <MessageList
            messages={messages}
            userId={userId}
            canPost={canPost}
            context="stream"
            onReact={onReact}
            onReply={onReply}
            onOpenThread={onOpenThread}
            onEdit={onEdit}
            onDelete={onDelete}
            onMessageUser={parent.type === "channel" ? onMessageUser : undefined}
          />
        )}
      </div>

      <Composer
        canPost={canPost}
        isAuthed={isAuthed}
        placeholder={parent.type === "channel" ? `Message # ${parent.name}` : `Message @${parent.name}`}
        initialText={initialComposerText}
        autoFocus={!!initialComposerText}
        onSend={onSend}
      />
    </div>
  );
}

function EmptyStream({ parent }: { parent: Parent }) {
  return (
    <div className="flex h-full items-center px-1 py-8">
      <p className="text-sm text-contour">
        {parent.type === "channel" ? (
          <>
            No one has said anything in <span className="text-ink">#{parent.name}</span> yet.
          </>
        ) : (
          <>
            No messages yet — say hello to <span className="text-ink">@{parent.name}</span>.
          </>
        )}
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
