"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Phase = "loading" | "signed-out" | "need-handle" | "ready";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export default function AccountControl() {
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Resolve the profile for a signed-in user to decide handle-claim vs ready.
  const resolveProfile = useCallback(
    async (u: User) => {
      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("id", u.id)
        .maybeSingle();
      if (data?.handle) {
        setHandle(data.handle);
        setPhase("ready");
      } else {
        setPhase("need-handle");
      }
    },
    [supabase]
  );

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (data.user) {
        setUser(data.user);
        resolveProfile(data.user);
      } else {
        setPhase("signed-out");
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setUser(session.user);
        resolveProfile(session.user);
      } else {
        setUser(null);
        setHandle(null);
        setPhase("signed-out");
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, resolveProfile]);

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 font-sans">
      {phase === "loading" && (
        <div className="border border-contour bg-paper px-3 py-2 text-xs uppercase tracking-widest text-contour">
          ····
        </div>
      )}

      {phase === "signed-out" &&
        (open ? (
          <SignInPanel supabase={supabase} onClose={() => setOpen(false)} />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="border border-ink bg-paper px-3 py-2 text-xs font-medium uppercase tracking-widest text-ink transition-[border-width] hover:border-2"
          >
            Sign in
          </button>
        ))}

      {phase === "need-handle" && user && (
        <HandleClaim
          supabase={supabase}
          userId={user.id}
          onClaimed={(h) => {
            setHandle(h);
            setPhase("ready");
          }}
        />
      )}

      {phase === "ready" && handle && (
        <AccountBadge handle={handle} onSignOut={() => supabase.auth.signOut()} />
      )}
    </div>
  );
}

function KindLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-contour">
      {children}
    </div>
  );
}

function SignInPanel({
  supabase,
  onClose,
}: {
  supabase: ReturnType<typeof createClient>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  }

  return (
    <div className="w-64 border border-ink bg-paper p-3 shadow-[2px_2px_0_0_var(--ink)]">
      <div className="mb-3 flex items-start justify-between">
        <KindLabel>Sign in</KindLabel>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 font-mono text-sm text-contour hover:text-ink"
        >
          ✕
        </button>
      </div>

      {status === "sent" ? (
        <p className="text-sm text-ink">
          Check <span className="font-mono">{email}</span> for a sign-in link.
        </p>
      ) : (
        <>
          <form onSubmit={sendMagicLink} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-contour bg-paper px-2 py-1.5 font-mono text-sm text-ink placeholder:text-contour focus:border-ink focus:outline-none"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-magenta px-3 py-1.5 text-xs font-medium uppercase tracking-widest text-paper disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Email me a link"}
            </button>
          </form>

          <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-contour">
            <span className="h-px flex-1 bg-contour" />
            or
            <span className="h-px flex-1 bg-contour" />
          </div>

          <button
            onClick={google}
            className="w-full border border-ink bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-widest text-ink hover:border-2"
          >
            Continue with Google
          </button>

          {status === "error" && <p className="mt-2 text-xs text-magenta">{message}</p>}
        </>
      )}
    </div>
  );
}

function HandleClaim({
  supabase,
  userId,
  onClaimed,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  onClaimed: (handle: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const normalized = value.toLowerCase();
  const valid = HANDLE_RE.test(normalized);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("3–20 chars: lowercase letters, numbers, underscore.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: insErr } = await supabase
      .from("profiles")
      .insert({ id: userId, handle: normalized });
    setSaving(false);
    if (insErr) {
      setError(insErr.code === "23505" ? "That handle is taken." : insErr.message);
      return;
    }
    onClaimed(normalized);
  }

  return (
    <form
      onSubmit={claim}
      className="w-64 border border-ink bg-paper p-3 shadow-[2px_2px_0_0_var(--ink)]"
    >
      <KindLabel>Claim your handle</KindLabel>
      <div className="flex items-center border border-contour bg-paper focus-within:border-ink">
        <span className="pl-2 font-mono text-sm text-contour">@</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="handle"
          className="w-full bg-paper px-1 py-1.5 font-mono text-sm text-ink placeholder:text-contour focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={saving || !valid}
        className="mt-2 w-full bg-magenta px-3 py-1.5 text-xs font-medium uppercase tracking-widest text-paper disabled:opacity-60"
      >
        {saving ? "Claiming…" : "Claim"}
      </button>
      {error && <p className="mt-2 text-xs text-magenta">{error}</p>}
    </form>
  );
}

function AccountBadge({ handle, onSignOut }: { handle: string; onSignOut: () => void }) {
  return (
    <div className="flex items-center gap-2 border border-ink bg-paper px-3 py-2">
      <span className="font-mono text-sm text-ink">@{handle}</span>
      <span className="h-4 w-px bg-contour" />
      <button
        onClick={onSignOut}
        className="text-[10px] font-semibold uppercase tracking-widest text-contour hover:text-magenta"
      >
        Sign out
      </button>
    </div>
  );
}
