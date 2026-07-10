# Decisions

Append-only log of judgment calls not dictated by [SPEC.md](./SPEC.md). One line
each: date — decision — why. (Per SPEC.md §2.7.)

- 2026-07-09 — Package manager is pnpm (via corepack), per SPEC.md Phase 5 criteria which references `pnpm dev`. — Spec assumes pnpm.
- 2026-07-09 — Scaffolded with `create-next-app` giving Next.js 16.2 / React 19 (spec says "Next.js 15"). — Latest stable at build time; App Router API used is compatible with the spec's intent. Revisit only if a spec-required behavior breaks.
- 2026-07-09 — MapLibre is mounted client-only through a small `MapLoader` wrapper because App Router disallows `ssr:false` `next/dynamic` inside Server Components. — Framework constraint; keeps the map out of SSR where it cannot run.
- 2026-07-09 — "The Survey" base-map desaturation is done by transforming the Liberty **style JSON** (`components/map/mapStyle.ts`), not by a CSS canvas filter. — A CSS `saturate()` filter over the whole canvas also washes the oceans to near-white, violating SPEC.md §7 "keep water recognizably blue." The style transform desaturates land while explicitly recoloring water to a hydrographic blue.
- 2026-07-09 — Water fill recolored to a muted pale blue (hue 210, low saturation) rather than the full-strength `--water` (#3B6FA0) token. — #3B6FA0 as an ocean fill is too heavy for a chart-paper aesthetic; the `--water` token is reserved for links/active UI and water *labels*. Ocean saturation is a tunable and may be revisited during Phase 5 polish.
