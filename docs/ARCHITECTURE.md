# Architecture

Living document. The authoritative product/engineering spec is [SPEC.md](./SPEC.md);
this file records how the running system actually fits together and is updated as
phases land.

## Overview

Gazetteer is a single Next.js 15+ (App Router, TypeScript) application. There is
no monorepo. The map is the entire product surface; everything else (place
sheets, chat) renders on top of a persistent full-viewport MapLibre canvas.

```
Browser (MapLibre canvas + React UI)
   │
   ├── OpenFreeMap Liberty vector tiles  (base map, direct from tiles.openfreemap.org)
   │
   └── Next.js server
         ├── /api/geo/*   proxy routes → Nominatim (search) + Overpass (place data)
         └── Supabase     Postgres + PostGIS (places, ancestry, chats, messages),
                          Auth (magic link + Google), Realtime (message changes)
```

## Folder map

| Path | Responsibility |
|---|---|
| `app/` | Routes. `app/page.tsx` is the map root `/`; `app/api/geo/*` are the geocoding/Overpass proxies. |
| `components/map/` | Map canvas, style transform, layers, controls. |
| `components/place/` | Place sheet, breadcrumb, directory. |
| `components/chat/` | Message list, composer. |
| `lib/supabase/` | Supabase clients (browser, server, service-role). |
| `lib/geo/` | Containment, OSM hydration, geometry utilities. |
| `supabase/migrations/` | Numbered SQL migrations — the source of truth for the DB schema. |
| `docs/` | This file, `SPEC.md`, and `DECISIONS.md` (append-only log). |

## Map (Phase 0)

- **Renderer:** MapLibre GL JS, mounted client-only via `components/map/MapLoader.tsx`
  (a `"use client"` wrapper that `dynamic(..., { ssr: false })`-imports
  `MapCanvas.tsx`). MapLibre needs `window`/WebGL, so it must never render on the
  server.
- **Base tiles:** OpenFreeMap Liberty (`https://tiles.openfreemap.org/styles/liberty`).
  The URL is a single constant (`STYLE_URL` in `MapCanvas.tsx`) so it can later be
  swapped for a self-hosted Protomaps PMTiles style with no other code changes.
- **"The Survey" restyle:** `components/map/mapStyle.ts` exports `surveyStyle()`,
  which fetches the Liberty style JSON once and recolors it before the map is
  constructed (so there is no flash of the original full-color style):
  - land / landcover / buildings → saturation cut hard, lightness nudged toward
    the `--paper` token;
  - water / waterways → recolored to a consistent muted hydrographic blue
    (spec §7 requires water stay *recognizably blue*);
  - labels → pushed toward `--ink` for a printed-chart feel;
  - background → `--paper`.
  All Liberty color paint properties are static strings (no data-driven
  expressions on color props), so a string-in/string-out pass is sufficient. If a
  future base style uses expression-valued colors, the transform leaves them
  untouched rather than corrupting them.

### OSM feature identity from tiles (verified — Phase 2)

The spec (§4.1) assumed OpenFreeMap tiles expose OSM ids as a feature *property*.
They do not. Verified by decoding a live tile (z14 over Encino, LA) and
cross-checking against Overpass:

- The OpenMapTiles-schema layers (`poi`, `place`, `boundary`, `building`, …) do
  **not** carry `osm_id` in their properties. Only the `water` layer has an `id`.
- OpenFreeMap is generated with **Planetiler**, which puts an encoded OSM id in
  the MVT **feature id** (`feature.id`, the top-level id — not a property).
- The encoding is `feature.id = osm_id * 10 + typeCode`. The numeric OSM id is
  therefore `Math.floor(feature.id / 10)` and this is reliable (verified:
  `1509624051 → node 150962405 = "Encino"`).
- The trailing `typeCode` is **not** a reliable node/way/relation discriminator
  (observed both a hospital-way and a boundary-way with different trailing
  digits). So we do not decode the type from it.

**Resolution strategy (`lib/geo/overpass.ts`):** on tap, the client reads
`feature.id`, `feature.properties.name`, the source layer, and the tap lng/lat
via `queryRenderedFeatures`, and posts them to `/api/geo/hydrate`. The server
computes `osmId = floor(featureId / 10)` and asks Overpass for
`(node(osmId); way(osmId); relation(osmId)); out tags center;`, then picks the
element that carries tags (disambiguating by name when more than one matches).
That yields the canonical `osm_type + osm_id` — identity stays sacred (§2.1) —
without trusting the fragile type code. The tapped `name`/lng/lat also drive a
spatial-by-name fallback if the id lookup misses.

Note the layer a feature comes from: **place labels** (cities, countries,
neighborhoods) resolve to OSM place **nodes** (points, no polygon); the
**boundary** layer resolves to boundary **ways** (segments). Neither is the full
admin-area relation+polygon. Phase 2 stores the point identity + kind; resolving
an admin area to its relation and multipolygon (for the surveyed-parcel outline
and containment) is Phase 3 work.

## Data model

See `supabase/migrations/` (source of truth) and SPEC.md §3. Not yet created
(Phase 1).

## Extensibility note (per SPEC.md §9)

The schema models **places as generic containers**. v1 ships exactly one
container type — a group chat (`chats` + `messages`). Calendars, notes, and
playlists are explicitly out of scope for v1 but the `places` design is meant to
accommodate additional container types later without reshaping place identity or
containment. Do not build them now; do preserve that generality.
