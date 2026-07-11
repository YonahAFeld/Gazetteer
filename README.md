# Gazetteer

Gazetteer is open source — channels for every place. Open the map, select a
place, join conversations.

> Working name. A *gazetteer* is literally a geographical directory of places.

## Status

Early build, executed phase-by-phase against [`docs/SPEC.md`](docs/SPEC.md).

- **Phase 0 — Skeleton:** ✅ Next.js + TypeScript + Tailwind v4, the "Survey"
  design tokens and fonts, and a full-viewport MapLibre map on OpenFreeMap
  Liberty tiles, restyled to a desaturated chart-paper look.
- Phases 1–5 (schema + auth, select + hydrate, containment + breadcrumb, chat,
  polish) — not started.

## Stack

Next.js (App Router, TS) · MapLibre GL JS · OpenFreeMap tiles · Supabase
(Postgres + PostGIS, Auth, Realtime) · Nominatim + Overpass for place data ·
Tailwind CSS v4 · deployed on Vercel. License: AGPL-3.0.

## Local development

Requires Node 20+ and [pnpm](https://pnpm.io) (via `corepack enable pnpm`).

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm build        # production build
pnpm lint         # eslint
```

The map route works with no configuration (tiles load directly from OpenFreeMap).
Supabase environment variables and a local Supabase stack are introduced in
Phase 1; see the docs below.

## Docs

- [`docs/SPEC.md`](docs/SPEC.md) — the authoritative product + engineering spec.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the running system fits together.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — append-only log of judgment calls.
