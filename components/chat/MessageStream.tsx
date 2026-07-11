"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, Parent, ReplyPreview } from "@/lib/chat/types";
import MessageList from "./MessageList";
import Composer from "./Composer";
import ShareChannelButton from "./ShareChannelButton";

interface MessageStreamProps {
  placeId: string;
  parent: Parent;
  messages: ChatMessage[];
  loading: boolean;
  gated?: boolean;
  userId: string | null;
  canPost: boolean;
  isAuthed: boolean;
  memberCount?: number;
  replyPreview?: ReplyPreview | null;
  onCancelReply?: () => void;
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
  placeId,
  parent,
  messages,
  loading,
  gated,
  userId,
  canPost,
  isAuthed,
  memberCount,
  replyPreview,
  onCancelReply,
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
        {parent.type === "channel" && parent.slug && (
          <ShareChannelButton placeId={placeId} channelSlug={parent.slug} />
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <MessagesSkeleton />
        ) : gated ? (
          <GatedNotice />
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

      {replyPreview && (
        <div className="flex items-start gap-2 border-l-2 border-magenta bg-contour/10 py-1.5 pl-2 pr-1">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-magenta">
              Replying to {replyPreview.authorHandle ? `@${replyPreview.authorHandle}` : "them"}
            </p>
            {replyPreview.sourceLabel && (
              <p className="font-mono text-[10px] text-contour">{replyPreview.sourceLabel}</p>
            )}
            <p className="truncate text-xs text-contour">{replyPreview.body}</p>
          </div>
          <button
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 px-1 font-mono text-sm text-contour hover:text-magenta"
          >
            ✕
          </button>
        </div>
      )}

      <Composer
        canPost={canPost}
        isAuthed={isAuthed}
        placeholder={parent.type === "channel" ? `Message # ${parent.name}` : `Message @${parent.name}`}
        autoFocus={!!replyPreview}
        onSend={onSend}
      />
    </div>
  );
}

function GatedNotice() {
  return (
    <div className="flex h-full items-center px-1 py-8">
      <p className="text-sm text-contour">
        This channel is getting a lot of new activity.{" "}
        <span className="text-ink">Sign in to keep reading.</span>
      </p>
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
