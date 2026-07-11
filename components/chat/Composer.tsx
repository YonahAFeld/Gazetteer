"use client";

import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  canPost: boolean;
  isAuthed: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Prefills the draft once, at mount — e.g. a quoted excerpt when replying
   * privately to a message. Callers force a remount (via `key`) to reapply it. */
  initialText?: string;
  onSend: (body: string) => Promise<void>;
}

/** Shared composer for channels, DMs, and threads. Keeps anonymous users
 * read-only with an inline sign-in nudge — never a modal wall. */
export default function Composer({ canPost, isAuthed, placeholder, autoFocus, initialText, onSend }: ComposerProps) {
  const [text, setText] = useState(() => initialText ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cursor after the quoted excerpt, not before it — so typing continues
  // the reply rather than interrupting the quote.
  useEffect(() => {
    if (initialText && textareaRef.current) {
      const len = initialText.length;
      textareaRef.current.setSelectionRange(len, len);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canPost) {
    return (
      <div className="border-t border-contour pt-3 text-sm text-contour">
        {isAuthed ? "Claim a handle (top-right) to talk here." : "Sign in (top-right) to talk here."}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    setText("");
    try {
      await onSend(body);
    } catch (err) {
      setText(body);
      const code = (err as { code?: string })?.code;
      const msg = (err as { message?: string })?.message ?? "";
      setError(code === "P0001" || /rate_limited/.test(msg) ? "Slow down a moment." : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-contour pt-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={placeholder ?? "Say something…"}
          className="max-h-28 min-h-9 w-full resize-none border border-contour bg-paper px-2 py-2 text-sm text-ink placeholder:text-contour focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="h-9 shrink-0 bg-magenta px-3 text-xs font-medium uppercase tracking-widest text-paper disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-magenta">{error}</p>}
    </form>
  );
}
