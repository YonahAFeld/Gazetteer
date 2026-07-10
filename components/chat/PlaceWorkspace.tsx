"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/chat/useIdentity";
import { useWorkspace } from "@/lib/chat/useWorkspace";
import { useStream } from "@/lib/chat/useStream";
import type { Channel, DmThread, Parent } from "@/lib/chat/types";
import PlaceRail from "./PlaceRail";
import MessageStream from "./MessageStream";
import ThreadPanel from "./ThreadPanel";

/**
 * A place's chat workspace: a rail of channels + DMs, a message stream for the
 * open conversation, and a thread panel that overlays the stream. On desktop the
 * rail sits beside the stream; on mobile they're a push stack (rail → stream →
 * thread). Selecting a conversation never touches the map's camera.
 */
export default function PlaceWorkspace({ placeId }: { placeId: string }) {
  const identity = useIdentity();
  const { userId, handle, isAuthed, canPost } = identity;
  const workspace = useWorkspace(placeId, isAuthed);
  const { channels, dms, loading: railLoading, refresh, markReadLocal, createChannel, openDm } = workspace;

  const [active, setActive] = useState<Parent | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const stream = useStream(active, userId, handle);
  const { messages, threads, loading: streamLoading, send, react, edit, remove, loadThread } = stream;

  // Desktop opens #general by default; mobile starts on the rail. One-time,
  // once channels load — guarded by a ref so it never re-fires.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || active || channels.length === 0) return;
    autoPicked.current = true;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      const general = channels.find((c) => c.slug === "general") ?? channels[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount default after async channel load
      setActive({ type: "channel", id: general.id, name: general.name });
      markReadLocal("channel", general.id);
    }
  }, [active, channels, markReadLocal]);

  const selectChannel = useCallback(
    (c: Channel) => {
      setThreadRootId(null);
      setActive({ type: "channel", id: c.id, name: c.name });
      markReadLocal("channel", c.id);
    },
    [markReadLocal]
  );

  const selectDm = useCallback(
    (d: DmThread) => {
      setThreadRootId(null);
      setActive({ type: "dm", id: d.thread_id, name: d.other_handle ?? "someone" });
      markReadLocal("dm", d.thread_id);
    },
    [markReadLocal]
  );

  const backToRail = useCallback(() => {
    setThreadRootId(null);
    setActive(null);
    void refresh();
  }, [refresh]);

  const openThread = useCallback(
    (rootId: string) => {
      setThreadRootId(rootId);
      if (!threads[rootId]) void loadThread(rootId);
    },
    [threads, loadThread]
  );

  const messageUser = useCallback(
    async (authorId: string) => {
      setActionError("");
      try {
        const dm = await openDm(authorId);
        if (dm) selectDm(dm);
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? "";
        setActionError(/posted here first/.test(msg) ? "You can DM someone once you've both posted here." : "Couldn't open that DM.");
      }
    },
    [openDm, selectDm]
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
            parent={active}
            messages={messages}
            loading={streamLoading}
            userId={userId}
            canPost={canPost}
            isAuthed={isAuthed}
            memberCount={activeChannel?.member_count}
            onBack={backToRail}
            onSend={(body) => send(body)}
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
