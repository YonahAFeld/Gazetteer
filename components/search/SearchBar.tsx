"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/app/api/geo/search/route";

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
}

/**
 * Persistent, always-visible search pill (SPEC.md §5) — Google Maps-style:
 * glued to top-center, expands downward into a results list while typing.
 * "/" focuses it from anywhere (unless already typing in another field).
 */
export default function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || document.activeElement === inputRef.current) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      if (mySeq === seq.current) setError("");
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => null);
        if (mySeq !== seq.current) return;
        if (!res.ok) {
          setResults([]);
          setError(res.status === 429 ? "Slow down a moment." : "Couldn't search.");
          return;
        }
        // Defensive: never trust the shape of a fetch response — a malformed
        // or error body here used to destructure to `undefined` and crash
        // the render the moment it hit .map() (SPEC.md §5 fallout, real bug).
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        if (mySeq === seq.current) {
          setResults([]);
          setError("Couldn't search.");
        }
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const visibleResults = q.length >= 2 ? results : [];
  const visibleError = q.length >= 2 ? error : "";
  const showList = focused && q.length >= 2;

  function select(r: SearchResult) {
    onSelect(r);
    setQuery("");
    setResults([]);
    setError("");
    inputRef.current?.blur();
  }

  function clear() {
    setQuery("");
    setResults([]);
    setError("");
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (visibleResults[0]) select(visibleResults[0]);
  }

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-20 w-[92%] max-w-md -translate-x-1/2 font-sans">
      <div className="overflow-hidden rounded-3xl border border-contour bg-paper shadow-[0_4px_20px_rgba(26,26,24,0.18)]">
        <form onSubmit={submit} className="flex items-center gap-2.5 px-4 py-3">
          <SearchIcon className="h-4 w-4 shrink-0 text-contour" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") clear();
            }}
            placeholder="Search a place…"
            className="w-full bg-paper text-sm text-ink placeholder:text-contour focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              aria-label="Clear search"
              className="shrink-0 font-mono text-sm text-contour hover:text-ink"
            >
              ✕
            </button>
          )}
        </form>

        {showList && (
          <ul className="max-h-72 overflow-y-auto border-t border-contour/60">
            {loading && visibleResults.length === 0 && !visibleError && (
              <li className="px-4 py-2.5 text-sm text-contour">Searching…</li>
            )}
            {visibleError && visibleResults.length === 0 && (
              <li className="px-4 py-2.5 text-sm text-magenta">{visibleError}</li>
            )}
            {!loading && !visibleError && visibleResults.length === 0 && (
              <li className="px-4 py-2.5 text-sm text-contour">No places found.</li>
            )}
            {visibleResults.map((r) => (
              <li key={r.osmId}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(r)}
                  className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-contour/15"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
