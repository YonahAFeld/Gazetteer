"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Identity {
  userId: string | null;
  handle: string | null;
  avatarUrl: string | null;
  isAuthed: boolean;
  /** Signed in AND has claimed a handle — the bar for posting. */
  canPost: boolean;
  /** Called after a successful avatar change so every consumer sees it immediately. */
  setAvatarUrl: (url: string | null) => void;
}

/**
 * The current viewer: user id + claimed handle + avatar. Drives who can post,
 * own-message styling, and what the account badge shows. Re-reads on auth
 * state changes.
 */
export function useIdentity(): Identity {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserId(data.user?.id ?? null);
      if (!data.user) {
        setHandle(null);
        setAvatarUrl(null);
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("handle, avatar_url")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!active) return;
      setHandle(prof?.handle ?? null);
      setAvatarUrl(prof?.avatar_url ?? null);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  return {
    userId,
    handle,
    avatarUrl,
    isAuthed: !!userId,
    canPost: !!userId && !!handle,
    setAvatarUrl,
  };
}
