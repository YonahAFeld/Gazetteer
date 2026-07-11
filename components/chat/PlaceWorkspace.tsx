"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/chat/useIdentity";
import { useWorkspace } from "@/lib/chat/useWorkspace";
import { useStream } from "@/lib/chat/useStream";
import type { ChatMessage, Channel, DmThread, Parent, ReplyPreview } from "@/lib/chat/types";
import PlaceRail from "./PlaceRail";
import MessageStream from "./MessageStream";
import ThreadPanel from "./ThreadPanel";

const QUOTE_SNIPPET_MAX = 120;

interface ReplyContext extends ReplyPreview {
  /** Which DM thread this quote belongs to — the banner only shows there. */
  forThreadId: string;
}

function snippet(body: string): string {
  return body.length > QUOTE_SNIPPET_MAX ? `${body.slice(0, QUOTE_SNIPPET_MAX)}…` : body;
}

/** Folds the quoted context into the actual message body, since there's no
 * schema-level "reply to" reference — this is the one place that context is
 * preserved once the message is sent and the banner is gone. */
function withQuote(reply: ReplyPreview, body: string): string {
  const who = reply.authorHandle ? `@${reply.authorHandle}` : "them";
  const where = reply.sourceLabel ? ` in ${reply.sourceLabel}` : "";
  return `Replying to ${who}${where}: "${snippet(reply.body)}"\n\n${body}`;
}

/**
 * A place's chat workspace: a rail of channels + DMs, a message stream for the
 * open conversation, and a thread panel that overlays the stream. On desktop the
 * rail sits beside the stream; on mobile they're a push stack (rail → stream →
 * thread). Selecting a conversation never touches the map's camera.
 */
interface PlaceWorkspaceProps {
  placeId: string;
  placeName?: string;
  /** Channel slug from a deep link (`/p/[placeId]/[channelSlug]`), if any. */
  initialChannelSlug?: string | null;
}

export default function PlaceWorkspace({ placeId, placeName, initialChannelSlug }: PlaceWorkspaceProps) {
  const identity = useIdentity();
  const { userId, handle, avatarUrl, isAuthed, canPost } = identity;
  const workspace = useWorkspace(placeId, isAuthed);
  const { channels, dms, loading: railLoading, refresh, markReadLocal, createChannel, openDm } = workspace;

  const [active, setActive] = useState<Parent | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);
  const [composerNonce, setComposerNonce] = useState(0);

  const stream = useStream(active, userId, handle, avatarUrl);
  const { messages, threads, loading: streamLoading, gated, send, react, edit, remove, loadThread } = stream;

  // Resolves `initialChannelSlug` to a channel and activates it — both at
  // mount (a deep link) and whenever it changes afterward (MapView's popstate
  // handler updates it on browser back/forward). Guarded by a ref keyed to
  // the slug value itself, NOT to `active`, so this never re-fires (and never
  // fights) when the user picks a channel by hand — those calls go through
  // `selectChannel` below and never touch `initialChannelSlug` at all.
  const appliedSlug = useRef<{ done: boolean; value: string | null }>({ done: false, value: null });
  useEffect(() => {
    if (channels.length === 0) return;
    const slug = initialChannelSlug ?? null;
    if (appliedSlug.current.done && appliedSlug.current.value === slug) return;
    appliedSlug.current = { done: true, value: slug };

    // A deep link (slug present) always resolves to a specific channel, even
    // on mobile — landing in the exact shared channel is the whole point. A
    // bare place open/return keeps the desktop-only "#general by default,
    // mobile starts on the rail" convenience.
    const requested = slug ? channels.find((c) => c.slug === slug) : undefined;
    const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    // Falls back to #general/first whenever a channel must be picked but the
    // requested slug didn't match — never errors on a stale/bad shared link.
    const target = requested ?? (slug || isDesktop ? channels.find((c) => c.slug === "general") ?? channels[0] : null);

    setThreadRootId(null);
    if (!target) {
      // Reacting to an external prop (deep-link/popstate slug), not
      // derivable state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(null);
      return;
    }
    setActive({ type: "channel", id: target.id, name: target.name, slug: target.slug });
    markReadLocal("channel", target.id);
  }, [channels, markReadLocal, initialChannelSlug]);

  const selectChannel = useCallback(
    (c: Channel) => {
      setThreadRootId(null);
      setActive({ type: "channel", id: c.id, name: c.name, slug: c.slug });
      markReadLocal("channel", c.id);
      window.history.pushState(null, "", `/p/${placeId}/${c.slug}`);
    },
    [markReadLocal, placeId]
  );

  const selectDm = useCallback(
    (d: DmThread) => {
      setThreadRootId(null);
      setActive({ type: "dm", id: d.thread_id, name: d.other_handle ?? "someone" });
      markReadLocal("dm", d.thread_id);
      // DMs aren't shareable — back to the bare (channel-less) place URL so
      // the address bar never points at a private conversation.
      window.history.pushState(null, "", `/p/${placeId}`);
    },
    [markReadLocal, placeId]
  );

  const backToRail = useCallback(() => {
    setThreadRootId(null);
    setActive(null);
    void refresh();
    window.history.pushState(null, "", `/p/${placeId}`);
  }, [refresh, placeId]);

  const openThread = useCallback(
    (rootId: string) => {
      setThreadRootId(rootId);
      if (!threads[rootId]) void loadThread(rootId);
    },
    [threads, loadThread]
  );

  const messageUser = useCallback(
    async (authorId: string, message: ChatMessage) => {
      setActionError("");
      // Captured now, before selectDm below switches `active` to the DM —
      // this is the last moment the source channel is still "active".
      const sourceLabel = active?.type === "channel" ? `#${active.name}${placeName ? ` · ${placeName}` : ""}` : null;
      try {
        const dm = await openDm(authorId);
        if (dm) {
          setReplyContext({
            forThreadId: dm.thread_id,
            authorHandle: message.handle,
            body: message.body,
            sourceLabel,
          });
          setComposerNonce((n) => n + 1);
          selectDm(dm);
        }
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? "";
        setActionError(/posted here first/.test(msg) ? "You can DM someone once you've both posted here." : "Couldn't open that DM.");
      }
    },
    [active, placeName, openDm, selectDm]
  );

  // Only show the banner while the matching DM is actually open — no
  // explicit clearing needed when the user navigates elsewhere and back.
  const activeReplyPreview =
    replyContext && active?.type === "dm" && active.id === replyContext.forThreadId ? replyContext : null;

  const sendWithReply = useCallback(
    async (body: string) => {
      await send(activeReplyPreview ? withQuote(activeReplyPreview, body) : body);
      if (activeReplyPreview) setReplyContext(null);
    },
    [activeReplyPreview, send]
  );

  const createAndOpen = useCallback(
    async (name: string) => {
      const c = await createChannel(name);
      if (c) selectChannel({ ...c, unread: false, member_count: 0 });
    },
    [createChannel, selectChannel]
  );

  const threadRoot = threadRootId ? messages.find((m) => m.id === threadRootId) : null;
  const activeChannel = active?.type === "channel" ? channels.find((c) => c.id === active.id) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <div
        className={`w-full shrink-0 md:w-48 md:border-r md:border-contour md:pr-3 ${
          active ? "hidden md:block" : "block"
        }`}
      >
        {railLoading ? (
          <RailSkeleton />
        ) : (
          <PlaceRail
            channels={channels}
            dms={dms}
            active={active}
            canPost={canPost}
            isAuthed={isAuthed}
            onSelectChannel={selectChannel}
            onSelectDm={selectDm}
            onCreateChannel={createAndOpen}
          />
        )}
      </div>

      <div
        className={`relative min-h-0 flex-1 md:pl-3 ${
          active ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        {actionError && (
          <div className="border-b border-magenta pb-1 text-xs text-magenta">{actionError}</div>
        )}
        {active ? (
          <MessageStream
            key={composerNonce}
            placeId={placeId}
            parent={active}
            messages={messages}
            loading={streamLoading}
            gated={gated}
            userId={userId}
            canPost={canPost}
            isAuthed={isAuthed}
            memberCount={activeChannel?.member_count}
            replyPreview={activeReplyPreview}
            onCancelReply={() => setReplyContext(null)}
            onBack={backToRail}
            onSend={sendWithReply}
            onReact={react}
            onReply={openThread}
            onOpenThread={openThread}
            onEdit={edit}
            onDelete={remove}
            onMessageUser={messageUser}
          />
        ) : (
          <div className="hidden h-full items-center justify-center md:flex">
            <p className="text-sm text-contour">Pick a channel to start.</p>
          </div>
        )}

        {threadRoot && (
          <ThreadPanel
            root={threadRoot}
            replies={threads[threadRoot.id]}
            userId={userId}
            canPost={canPost}
            isAuthed={isAuthed}
            onClose={() => setThreadRootId(null)}
            onSend={(body) => send(body, threadRoot.id)}
            onReact={react}
            onEdit={edit}
            onDelete={remove}
            onMessageUser={active?.type === "channel" ? messageUser : undefined}
          />
        )}
      </div>
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="animate-pulse space-y-2 py-1">
      <div className="h-2 w-16 bg-contour/40" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-3 w-24 bg-contour/30" />
      ))}
    </div>
  );
}
