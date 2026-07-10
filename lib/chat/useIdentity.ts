"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Identity {
  userId: string | null;
  handle: string | null;
  isAuthed: boolean;
  /** Signed in AND has claimed a handle — the bar for posting. */
  canPost: boolean;
}

/**
 * The current viewer: user id + claimed handle. Drives who can post and
 * own-message styling. Re-reads on auth state changes.
 */
export function useIdentity(): Identity {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

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
    isAuthed: !!userId,
    canPost: !!userId && !!handle,
  };
}
