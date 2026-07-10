"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "./types";

interface MessageRow {
  id: string;
  author_id: string;
  handle: string | null;
  body: string;
  created_at: string;
  chat_id?: string;
}

/**
 * Chat for a place: loads recent messages, subscribes to realtime inserts and
 * deletes, and sends optimistically (SPEC.md §6). The chat row is created lazily
 * by the first post (post_message RPC), so we only have a chat_id once messages
 * exist — we subscribe as soon as we learn it.
 */
export function useChat(placeId: string | null) {
  const [supabase] = useState(() => createClient());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(!!placeId);
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  const chatIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handleCache = useRef<Map<string, string>>(new Map());

  // Current user + handle (drives who can post and own-message styling).
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserId(data.user?.id ?? null);
      if (!data.user) {
        setHandle(null);
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("handle")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!active) return;
      setHandle(prof?.handle ?? null);
      if (prof?.handle) handleCache.current.set(data.user.id, prof.handle);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

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
      setMessages((prev) =>
        prev.map((m) => (m.author_id === authorId && !m.handle ? { ...m, handle: data.handle } : m))
      );
    },
    [supabase]
  );

  const subscribe = useCallback(
    (chatId: string) => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = supabase
        .channel(`chat:${chatId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const m = payload.new as MessageRow;
            setMessages((prev) =>
              prev.some((x) => x.id === m.id)
                ? prev
                : [
                    ...prev,
                    {
                      id: m.id,
                      author_id: m.author_id,
                      handle: handleCache.current.get(m.author_id) ?? null,
                      body: m.body,
                      created_at: m.created_at,
                    },
                  ]
            );
            void resolveHandle(m.author_id);
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const oldId = (payload.old as { id?: string }).id;
            if (oldId) setMessages((prev) => prev.filter((x) => x.id !== oldId));
          }
        )
        .subscribe();
    },
    [supabase, resolveHandle]
  );

  // Load messages + subscribe. The consumer remounts this hook per place (via a
  // `key`), so placeId is stable for the hook's life and this runs once.
  useEffect(() => {
    if (!placeId) return;

    let active = true;
    (async () => {
      const [{ data: rows }, { data: chat }] = await Promise.all([
        supabase.rpc("chat_messages", { p_place_id: placeId }),
        supabase.from("chats").select("id").eq("place_id", placeId).maybeSingle(),
      ]);
      if (!active) return;
      const list = ((rows ?? []) as MessageRow[]).slice().reverse(); // oldest → newest
      for (const m of list) if (m.handle) handleCache.current.set(m.author_id, m.handle);
      setMessages(list.map((m) => ({ ...m })));
      setLoading(false);
      if (chat?.id) {
        chatIdRef.current = chat.id;
        subscribe(chat.id);
      }
    })();

    return () => {
      active = false;
    };
  }, [placeId, supabase, subscribe]);

  useEffect(
    () => () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    },
    [supabase]
  );

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text || !placeId || !userId) return;
      const tempId = `temp-${crypto.randomUUID()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          author_id: userId,
          handle,
          body: text,
          created_at: new Date().toISOString(),
          pending: true,
        },
      ]);

      const { data, error } = await supabase.rpc("post_message", {
        p_place_id: placeId,
        p_body: text,
      });
      if (error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw error;
      }
      const real = data as MessageRow;
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === real.id)
          ? withoutTemp
          : [
              ...withoutTemp,
              {
                id: real.id,
                author_id: real.author_id,
                handle,
                body: real.body,
                created_at: real.created_at,
              },
            ];
      });
      if (!chatIdRef.current && real.chat_id) {
        chatIdRef.current = real.chat_id;
        subscribe(real.chat_id);
      }
    },
    [placeId, userId, handle, supabase, subscribe]
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      await supabase.from("messages").delete().eq("id", id);
    },
    [supabase]
  );

  return {
    messages,
    loading,
    userId,
    canPost: !!userId && !!handle,
    isAuthed: !!userId,
    send,
    deleteMessage,
  };
}
