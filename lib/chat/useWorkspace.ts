"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, DmThread } from "./types";

/**
 * The place rail's data: the place's channels (with unread + member count) and
 * the viewer's DM threads scoped to this place. Unread state is a snapshot —
 * it refreshes on mount, on `refresh()` (called when navigating between
 * conversations), so switching channels re-evaluates what's unread.
 */
export function useWorkspace(placeId: string | null, isAuthed: boolean) {
  const [supabase] = useState(() => createClient());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(!!placeId);

  const refresh = useCallback(async () => {
    if (!placeId) return;
    const [{ data: ch }, dmRes] = await Promise.all([
      supabase.rpc("place_channels", { p_place_id: placeId }),
      isAuthed
        ? supabase.rpc("place_dms", { p_place_id: placeId })
        : Promise.resolve({ data: [] as DmThread[] }),
    ]);
    setChannels((ch ?? []) as Channel[]);
    setDms((dmRes.data ?? []) as DmThread[]);
    setLoading(false);
  }, [placeId, isAuthed, supabase]);

  useEffect(() => {
    // refresh() only setState after awaiting the RPCs — safe, not synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Instantly clear a conversation's unread mark in the rail on open (the
  // server cursor advances via mark_read; this avoids waiting for a refetch).
  const markReadLocal = useCallback((type: "channel" | "dm", id: string) => {
    if (type === "channel") {
      setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    } else {
      setDms((prev) => prev.map((d) => (d.thread_id === id ? { ...d, unread: false } : d)));
    }
  }, []);

  const createChannel = useCallback(
    async (name: string): Promise<Channel | null> => {
      if (!placeId) return null;
      const { data, error } = await supabase.rpc("create_channel", {
        p_place_id: placeId,
        p_name: name,
      });
      if (error) throw error;
      await refresh();
      const row = (data as Channel[] | null)?.[0] ?? null;
      return row;
    },
    [placeId, supabase, refresh]
  );

  const openDm = useCallback(
    async (otherId: string): Promise<DmThread | null> => {
      if (!placeId) return null;
      const { data, error } = await supabase.rpc("open_dm", {
        p_place_id: placeId,
        p_other: otherId,
      });
      if (error) throw error;
      const row = (data as { thread_id: string; other_id: string; other_handle: string | null }[] | null)?.[0];
      await refresh();
      if (!row) return null;
      return {
        thread_id: row.thread_id,
        other_id: row.other_id,
        other_handle: row.other_handle,
        unread: false,
        last_at: null,
      };
    },
    [placeId, supabase, refresh]
  );

  return { channels, dms, loading, refresh, markReadLocal, createChannel, openDm };
}
