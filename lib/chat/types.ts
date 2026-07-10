export interface ChatMessage {
  id: string;
  author_id: string;
  handle: string | null;
  body: string;
  created_at: string;
  /** Client-only: an optimistic message awaiting server ack. */
  pending?: boolean;
}
