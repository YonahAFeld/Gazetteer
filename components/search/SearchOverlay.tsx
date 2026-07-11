"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/app/api/geo/search/route";

interface SearchOverlayProps {
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

/** `/`-triggered search (SPEC.md §5). Results are hydratable places — picking
 * one flies the map there and opens it exactly like a tap would. */
export default function SearchOverlay({ onClose, onSelect }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
        const { results } = (await res.json()) as { results: SearchResult[] };
        if (mySeq === seq.current) setResults(results);
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const showList = q.length >= 2;
  const visibleResults = showList ? results : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (visibleResults[0]) onSelect(visibleResults[0]);
  }

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[92%] max-w-md -translate-x-1/2 font-sans">
      <div className="border border-ink bg-paper shadow-[2px_2px_0_0_var(--ink)]">
        <form onSubmit={submit} className="flex items-center gap-2 border-b border-contour p-2.5">
          <span className="font-mono text-sm text-contour">/</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place…"
            className="w-full bg-paper text-sm text-ink placeholder:text-contour focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 font-mono text-sm text-contour hover:text-ink"
          >
            ✕
          </button>
        </form>

        {showList && (loading || visibleResults.length > 0) && (
          <ul className="max-h-72 overflow-y-auto">
            {loading && visibleResults.length === 0 && (
              <li className="px-3 py-2 text-sm text-contour">Searching…</li>
            )}
            {visibleResults.map((r) => (
              <li key={r.osmId}>
                <button
                  onClick={() => onSelect(r)}
                  className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-contour/15"
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
