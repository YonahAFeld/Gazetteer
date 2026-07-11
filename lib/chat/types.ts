export type ParentType = "channel" | "dm";

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatMessage {
  id: string;
  author_id: string;
  handle: string | null;
  avatar_url: string | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
  thread_root_id?: string | null;
  reply_count?: number;
  last_reply_at?: string | null;
  reactions?: Reaction[];
  /** Client-only: an optimistic message awaiting server ack. */
  pending?: boolean;
}

export interface Channel {
  id: string;
  slug: string;
  name: string;
  kind: "default" | "custom";
  unread: boolean;
  member_count: number;
}

export interface DmThread {
  thread_id: string;
  other_id: string;
  other_handle: string | null;
  other_avatar_url: string | null;
  unread: boolean;
  last_at: string | null;
}

/** The open conversation: a channel or a DM thread. `name` is what the stream header shows. */
export interface Parent {
  type: ParentType;
  id: string;
  name: string;
  /** Channel slug — present for `type: "channel"` only, used for its shareable URL. */
  slug?: string;
}

/** The quoted-message banner shown above a DM composer after tapping "reply privately". */
export interface ReplyPreview {
  authorHandle: string | null;
  body: string;
  /** Where the quoted message came from, e.g. "#general · Pembroke Pines". */
  sourceLabel: string | null;
}

export const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙌"] as const;
export const MORE_EMOJI = [
  "🎉", "🔥", "👀", "✅", "🙏", "💯", "😍", "🤔", "👏", "😅",
  "🚀", "☕", "🌿", "📍", "🗺️", "🍕",
] as const;
