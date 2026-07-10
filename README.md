# Gazetteer

An open source world map where every place, at every scale — café, block,
neighborhood, city, country — is a container you can open. The v1 container type
is a group chat: tap your coffee shop and read what neighbors said; tap "Los
Angeles" in the breadcrumb and say something to the whole city, without the map
ever leaving the screen.

The map is the navigation primitive — no feed, no search-first home screen. You
browse the world by panning and zooming, and every named thing on it (POIs *and*
administrative areas) is selectable.

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
