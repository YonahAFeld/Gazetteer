"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/avatar/upload";
import Avatar from "@/components/shared/Avatar";

type Phase = "loading" | "signed-out" | "need-handle" | "ready";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export default function AccountControl() {
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Resolve the profile for a signed-in user to decide handle-claim vs ready.
  const resolveProfile = useCallback(
    async (u: User) => {
      const { data } = await supabase
        .from("profiles")
        .select("handle, avatar_url")
        .eq("id", u.id)
        .maybeSingle();
      if (data?.handle) {
        setHandle(data.handle);
        setAvatarUrl(data.avatar_url ?? null);
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
        setAvatarUrl(null);
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

      {phase === "ready" && handle && user && (
        <AccountBadge
          supabase={supabase}
          userId={user.id}
          handle={handle}
          avatarUrl={avatarUrl}
          onAvatarChange={setAvatarUrl}
          onSignOut={() => supabase.auth.signOut()}
        />
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

function AccountBadge({
  supabase,
  userId,
  handle,
  avatarUrl,
  onAvatarChange,
  onSignOut,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  handle: string;
  avatarUrl: string | null;
  onAvatarChange: (url: string | null) => void;
  onSignOut: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AvatarEditPanel
        supabase={supabase}
        userId={userId}
        handle={handle}
        avatarUrl={avatarUrl}
        onSaved={(url) => {
          onAvatarChange(url);
          setEditing(false);
        }}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 border border-ink bg-paper px-3 py-2">
      <button
        onClick={() => setEditing(true)}
        aria-label={avatarUrl ? "Change profile picture" : "Add profile picture"}
        title={avatarUrl ? "Change profile picture" : "Add profile picture"}
        className="relative shrink-0"
      >
        <Avatar url={avatarUrl} handle={handle} size={20} />
        {!avatarUrl && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full border border-paper bg-magenta text-[7px] leading-none text-paper">
            +
          </span>
        )}
      </button>
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

function AvatarEditPanel({
  supabase,
  userId,
  handle,
  avatarUrl,
  onSaved,
  onClose,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  handle: string;
  avatarUrl: string | null;
  onSaved: (url: string | null) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const url = await uploadAvatar(supabase, userId, file);
      setPreview(url);
      onSaved(url);
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Couldn't upload that image.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("update_avatar", { p_avatar_url: null });
    setBusy(false);
    if (rpcErr) {
      setError("Couldn't remove that.");
      return;
    }
    setPreview(null);
    onSaved(null);
  }

  return (
    <div className="w-64 border border-ink bg-paper p-3 shadow-[2px_2px_0_0_var(--ink)]">
      <div className="mb-3 flex items-start justify-between">
        <KindLabel>Profile picture</KindLabel>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 font-mono text-sm text-contour hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Avatar url={preview} handle={handle} size={48} />
        <div className="flex flex-col items-start gap-1.5">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="border border-ink bg-paper px-2 py-1 text-xs font-medium uppercase tracking-widest text-ink hover:border-2 disabled:opacity-60"
          >
            {busy ? "Working…" : preview ? "Change" : "Upload"}
          </button>
          {preview && (
            <button
              onClick={onRemove}
              disabled={busy}
              className="text-[10px] font-semibold uppercase tracking-widest text-contour hover:text-magenta disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      {error && <p className="mt-2 text-xs text-magenta">{error}</p>}
    </div>
  );
}
