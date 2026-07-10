"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Parent, Reaction } from "./types";

interface Raw {
  id: string;
  author_id: string;
  handle: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  thread_root_id: string | null;
  reply_count: number;
  last_reply_at: string | null;
  reactions: Reaction[];
}

function bumpOther(reactions: Reaction[] | undefined, emoji: string, delta: number): Reaction[] {
  const arr = [...(reactions ?? [])];
  const i = arr.findIndex((r) => r.emoji === emoji);
  if (i === -1) return delta > 0 ? [...arr, { emoji, count: 1, mine: false }] : arr;
  const count = arr[i].count + delta;
  if (count <= 0) arr.splice(i, 1);
  else arr[i] = { ...arr[i], count };
  return arr;
}

function toggleMine(reactions: Reaction[] | undefined, emoji: string): Reaction[] {
  const arr = [...(reactions ?? [])];
  const i = arr.findIndex((r) => r.emoji === emoji);
  if (i === -1) return [...arr, { emoji, count: 1, mine: true }];
  if (arr[i].mine) {
    const count = arr[i].count - 1;
    if (count <= 0) arr.splice(i, 1);
    else arr[i] = { ...arr[i], count, mine: false };
  } else {
    arr[i] = { ...arr[i], count: arr[i].count + 1, mine: true };
  }
  return arr;
}

/**
 * One open conversation (channel or DM): its top-level messages plus a lazily
 * loaded map of thread replies, over a single realtime subscription. Thread
 * replies and reactions ride that same subscription (SPEC §4), so opening a
 * thread never opens a second socket.
 */
export function useStream(parent: Parent | null, userId: string | null, handle: string | null) {
  const [supabase] = useState(() => createClient());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  // Which parent the current `messages` belong to; drives loading without a
  // synchronous setState on every parent switch.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = !!parent && loadedFor !== parent.id;

  const channelsRef = useRef<RealtimeChannel[]>([]);
  const handleCache = useRef<Map<string, string>>(new Map());

  const readerFn = parent?.type === "dm" ? "dm_messages" : "channel_messages";
  const idArg = parent?.type === "dm" ? "p_thread_id" : "p_channel_id";

  // Apply an update to a message wherever it lives (main list or any thread).
  const patch = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    setThreads((prev) => {
      let touched = false;
      const next: Record<string, ChatMessage[]> = {};
      for (const [root, arr] of Object.entries(prev)) {
        next[root] = arr.map((m) => {
          if (m.id !== id) return m;
          touched = true;
          return fn(m);
        });
      }
      return touched ? next : prev;
    });
  }, []);

  const resolveHandle = useCallback(
    async (authorId: string) => {
      if (handleCache.current.has(authorId)) return;
      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("id", authorId)
        .maybeSingle();
      if (!data?.handle) return;
      handleCache.current.set(authorId, data.handle);
      const h = data.handle;
      setMessages((prev) => prev.map((m) => (m.author_id === authorId && !m.handle ? { ...m, handle: h } : m)));
      setThreads((prev) => {
        const next: Record<string, ChatMessage[]> = {};
        for (const [root, arr] of Object.entries(prev)) {
          next[root] = arr.map((m) => (m.author_id === authorId && !m.handle ? { ...m, handle: h } : m));
        }
        return next;
      });
    },
    [supabase]
  );

  const markRead = useCallback(() => {
    if (!parent || !userId) return;
    void supabase.rpc("mark_read", { p_parent_type: parent.type, p_parent_id: parent.id });
  }, [parent, userId, supabase]);

  // Load + subscribe. Runs once per parent (parent id changes tear down & rebuild).
  useEffect(() => {
    if (!parent) return;
    let active = true;

    (async () => {
      const { data } = await supabase.rpc(readerFn, { [idArg]: parent.id });
      if (!active) return;
      const list = ((data ?? []) as Raw[]).slice().reverse(); // oldest → newest
      for (const m of list) if (m.handle) handleCache.current.set(m.author_id, m.handle);
      setMessages(list);
      setThreads({});
      setLoadedFor(parent.id);
      markRead();
    })();

    // Messages and reactions ride SEPARATE realtime channels: combining two
    // postgres_changes bindings of different filter shapes on one channel makes
    // Supabase silently drop all of them. Splitting keeps each robust.
    const msgCh = supabase
      .channel(`stream:${parent.type}:${parent.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `parent_id=eq.${parent.id}` },
        (payload) => {
          const m = payload.new as {
            id: string;
            author_id: string;
            body: string;
            created_at: string;
            thread_root_id: string | null;
          };
          const row: ChatMessage = {
            id: m.id,
            author_id: m.author_id,
            handle: handleCache.current.get(m.author_id) ?? null,
            body: m.body,
            created_at: m.created_at,
            thread_root_id: m.thread_root_id,
            reactions: [],
          };
          if (m.thread_root_id) {
            // A reply: bump the root's counters, and append if that thread is open.
            patch(m.thread_root_id, (r) => ({
              ...r,
              reply_count: (r.reply_count ?? 0) + 1,
              last_reply_at: m.created_at,
            }));
            setThreads((prev) =>
              prev[m.thread_root_id!]
                ? prev[m.thread_root_id!].some((x) => x.id === m.id)
                  ? prev
                  : { ...prev, [m.thread_root_id!]: [...prev[m.thread_root_id!], row] }
                : prev
            );
          } else {
            setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, { ...row, reply_count: 0 }]));
          }
          void resolveHandle(m.author_id);
          if (m.author_id !== userId) markRead();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `parent_id=eq.${parent.id}` },
        (payload) => {
          const old = payload.old as { id?: string; thread_root_id?: string | null };
          if (!old.id) return;
          if (old.thread_root_id) {
            patch(old.thread_root_id, (r) => ({ ...r, reply_count: Math.max(0, (r.reply_count ?? 1) - 1) }));
            setThreads((prev) => {
              const arr = prev[old.thread_root_id!];
              if (!arr) return prev;
              return { ...prev, [old.thread_root_id!]: arr.filter((x) => x.id !== old.id) };
            });
          } else {
            setMessages((prev) => prev.filter((x) => x.id !== old.id));
          }
        }
      )
      .subscribe();

    const reactCh = supabase
      .channel(`react:${parent.type}:${parent.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reactions" },
        (payload) => {
          // Global stream (RLS limits it to channel reactions); apply only
          // others' events, and only for messages we're actually showing.
          const rec = (payload.new ?? payload.old) as { message_id?: string; user_id?: string; emoji?: string };
          if (!rec.message_id || !rec.emoji || rec.user_id === userId) return;
          const delta = payload.eventType === "DELETE" ? -1 : 1;
          patch(rec.message_id, (m) => ({ ...m, reactions: bumpOther(m.reactions, rec.emoji!, delta) }));
        }
      )
      .subscribe();

    channelsRef.current = [msgCh, reactCh];

    return () => {
      active = false;
      supabase.removeChannel(msgCh);
      supabase.removeChannel(reactCh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.type, parent?.id, supabase]);

  const send = useCallback(
    async (body: string, threadRootId?: string) => {
      const text = body.trim();
      if (!text || !parent || !userId) return;
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        author_id: userId,
        handle,
        body: text,
        created_at: new Date().toISOString(),
        thread_root_id: threadRootId ?? null,
        reactions: [],
        pending: true,
      };
      if (threadRootId) {
        setThreads((prev) => ({ ...prev, [threadRootId]: [...(prev[threadRootId] ?? []), optimistic] }));
        patch(threadRootId, (r) => ({ ...r, reply_count: (r.reply_count ?? 0) + 1 }));
      } else {
        setMessages((prev) => [...prev, optimistic]);
      }

      const { data, error } = await supabase.rpc("post_message_v2", {
        p_parent_type: parent.type,
        p_parent_id: parent.id,
        p_body: text,
        p_thread_root_id: threadRootId ?? null,
      });
      if (error) {
        if (threadRootId) {
          setThreads((prev) => ({
            ...prev,
            [threadRootId]: (prev[threadRootId] ?? []).filter((m) => m.id !== tempId),
          }));
          patch(threadRootId, (r) => ({ ...r, reply_count: Math.max(0, (r.reply_count ?? 1) - 1) }));
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
        }
        throw error;
      }
      const real = (data as Raw[])[0];
      const reconcile = (arr: ChatMessage[]) => {
        const without = arr.filter((m) => m.id !== tempId);
        return without.some((m) => m.id === real.id)
          ? without
          : [...without, { ...optimistic, id: real.id, created_at: real.created_at, pending: false }];
      };
      if (threadRootId) {
        setThreads((prev) => ({ ...prev, [threadRootId]: reconcile(prev[threadRootId] ?? []) }));
      } else {
        setMessages(reconcile);
      }
    },
    [parent, userId, handle, supabase, patch]
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      patch(messageId, (m) => ({ ...m, reactions: toggleMine(m.reactions, emoji) }));
      const { data, error } = await supabase.rpc("toggle_reaction", {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      if (error) {
        // Roll back the optimistic toggle.
        patch(messageId, (m) => ({ ...m, reactions: toggleMine(m.reactions, emoji) }));
        return;
      }
      const row = (data as { message_id: string; reactions: Reaction[] }[])[0];
      if (row) patch(messageId, (m) => ({ ...m, reactions: row.reactions }));
    },
    [supabase, patch]
  );

  const edit = useCallback(
    async (messageId: string, body: string) => {
      const text = body.trim();
      if (!text) return;
      patch(messageId, (m) => ({ ...m, body: text, edited_at: new Date().toISOString() }));
      await supabase.rpc("edit_message", { p_message_id: messageId, p_body: text });
    },
    [supabase, patch]
  );

  const remove = useCallback(
    async (messageId: string, threadRootId?: string | null) => {
      if (threadRootId) {
        setThreads((prev) => ({
          ...prev,
          [threadRootId]: (prev[threadRootId] ?? []).filter((m) => m.id !== messageId),
        }));
        patch(threadRootId, (r) => ({ ...r, reply_count: Math.max(0, (r.reply_count ?? 1) - 1) }));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
      await supabase.from("messages").delete().eq("id", messageId);
    },
    [supabase, patch]
  );

  const loadThread = useCallback(
    async (rootId: string) => {
      const { data } = await supabase.rpc("thread_messages", { p_root_id: rootId });
      const list = (data ?? []) as Raw[];
      for (const m of list) if (m.handle) handleCache.current.set(m.author_id, m.handle);
      setThreads((prev) => ({ ...prev, [rootId]: list }));
    },
    [supabase]
  );

  return { messages, threads, loading, send, react, edit, remove, loadThread };
}
