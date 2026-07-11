"use client";

import type { ChatMessage } from "@/lib/chat/types";
import MessageRow from "./MessageRow";

const FIVE_MIN = 5 * 60 * 1000;

interface MessageListProps {
  messages: ChatMessage[];
  userId: string | null;
  canPost: boolean;
  context: "stream" | "thread";
  onReact: (id: string, emoji: string) => void;
  onReply?: (id: string) => void;
  onOpenThread?: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string, threadRootId?: string | null) => void;
  onMessageUser?: (authorId: string, message: ChatMessage) => void;
}

export default function MessageList({ messages, userId, ...row }: MessageListProps) {
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
            <MessageRow message={m} startGroup={startGroup} isOwn={m.author_id === userId} {...row} />
          </li>
        );
      })}
    </ul>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-2">
      <span className="h-px flex-1 bg-contour" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-contour">{formatDay(iso)}</span>
      <span className="h-px flex-1 bg-contour" />
    </div>
  );
}

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
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
