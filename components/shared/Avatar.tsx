/**
 * A user's profile picture, or a bordered initial when they haven't set one.
 * Deliberately a plain <img>, not next/image — avatars are small, come from a
 * Supabase Storage public URL (no build-time domain to configure), and the
 * rest of this app never reaches for next/image either.
 */
export default function Avatar({
  url,
  handle,
  size = 20,
}: {
  url: string | null | undefined;
  handle: string | null | undefined;
  size?: number;
}) {
  const style = { width: size, height: size };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={style}
        className="shrink-0 rounded-full border border-ink object-cover"
      />
    );
  }

  return (
    <div
      style={{ ...style, fontSize: Math.max(9, size * 0.45) }}
      className="flex shrink-0 items-center justify-center rounded-full border border-ink bg-paper font-mono text-ink"
      aria-hidden
    >
      {handle ? handle[0].toUpperCase() : "?"}
    </div>
  );
}
