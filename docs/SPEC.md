# GAZETTEER — Build Instructions for Claude Code

> Working name: **Gazetteer** (a gazetteer is literally a geographical directory of places — rename later).
> One-line pitch: an open source world map where every place, at every scale — café, block, neighborhood, city, country — is a container you can open. v1 container type: group chat.

These instructions are written to be executed top-to-bottom by Claude Code. Each phase has acceptance criteria. Do not start a phase until the previous phase's criteria pass. Commit at the end of every phase with the phase name in the commit message.

---

## 0. Core product concept (read before writing any code)

- The **map is the navigation primitive**. There is no feed, no search-first home screen. You browse the world by panning and zooming, exactly like Google Maps.
- **Every named thing on the map is selectable**: POIs (cafés, parks, buildings) AND administrative areas (neighborhoods, cities, counties, states, countries).
- Tapping a place opens a **place sheet**: the place's chat, plus a breadcrumb of its parent places ("You're also in: Brentwood → Los Angeles → California → United States"). Tapping a breadcrumb hops you to that scale's chat. This scale-hopping moment is the product's signature — protect it.
- Places are **hybrid**: pre-existing OSM features + user-created custom pins.
- **Nested hierarchy is real**: Brentwood has its own chat, distinct from a café inside Brentwood. Containment is computed spatially, not hardcoded.
- One hosted instance, public codebase (Signal model). No federation, no self-hosting complexity in v1.

## 1. Stack (fixed — do not substitute)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router, TypeScript) | Developer familiarity, Vercel deploy |
| Map renderer | MapLibre GL JS | Open source, no Mapbox license entanglement |
| Base tiles | OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`) as default; architecture must allow swapping to self-hosted Protomaps PMTiles later | Free, open, OSM-based |
| Database | Supabase (Postgres + **PostGIS extension**) | Spatial queries + auth + realtime in one service |
| Realtime chat | Supabase Realtime (Postgres changes on `messages`) | No extra infra |
| Auth | Supabase Auth — email magic link + Google OAuth | Lowest friction |
| Geocoding/search | Nominatim public API in dev (respect 1 req/sec); wrap behind an internal `/api/geo/search` route so the provider can be swapped | Open, OSM-native |
| Place/boundary data | OSM via Overpass API (on-demand hydration, see §4) | Open IDs, open polygons |
| Styling | Tailwind CSS v4 + CSS custom properties for the token system in §7 | Speed without genericism (tokens override defaults) |
| Deploy | Vercel + Supabase cloud | Existing workflow |
| License | AGPL-3.0 | Keeps hosted forks open |

Repo shape: single Next.js app, no monorepo. Folders:

```
/app                  — routes
/app/api/geo/*        — geocoding + overpass proxy routes
/components/map       — map canvas, layers, controls
/components/place     — place sheet, breadcrumb, directory
/components/chat      — message list, composer
/lib/supabase         — clients (browser, server, service-role)
/lib/geo              — containment, OSM hydration, geometry utils
/supabase/migrations  — SQL migrations (source of truth for schema)
/docs                 — ARCHITECTURE.md, DECISIONS.md (append-only log)
```

## 2. Non-negotiable engineering principles

1. **Place identity is sacred.** A place's canonical ID is `osm_type + osm_id` (e.g., `way/123456`) for OSM-derived places, or a UUID for custom pins. Never key anything off names or coordinates.
2. **Lazy hydration, never bulk import.** Do NOT attempt to import planet-scale OSM data. Places enter the database the first time someone selects them (§4). The map tiles already render the whole world; the DB only stores places people have touched.
3. **Containment is computed, then cached.** PostGIS answers "what contains this point?"; results are memoized in an ancestry table (§3) so the breadcrumb renders in one indexed read.
4. **Everything through migrations.** Never mutate the Supabase schema from the dashboard. Every schema change is a numbered SQL file in `/supabase/migrations`.
5. **RLS on from day one.** Row Level Security policies on every table before any UI touches it.
6. **The map never blocks.** Chat loading, hydration, and containment queries happen while the map stays interactive at 60fps. All place-sheet data loads are non-blocking with skeleton states.
7. **Log decisions.** Any time you (Claude Code) make a judgment call not covered here, append one line to `/docs/DECISIONS.md`: date, decision, why.

## 3. Data model (write as migration 0001)

Enable PostGIS first: `create extension if not exists postgis;`

```sql
-- Every selectable container in the world
create table places (
  id uuid primary key default gen_random_uuid(),
  osm_type text check (osm_type in ('node','way','relation')), -- null for custom pins
  osm_id bigint,                          -- null for custom pins
  kind text not null check (kind in ('poi','building','neighborhood','locality','city','county','state','country','custom')),
  name text not null,
  centroid geography(point, 4326) not null,
  boundary geography(multipolygon, 4326), -- null for point-only places
  admin_level smallint,                   -- from OSM, drives hierarchy ordering
  created_by uuid references auth.users,  -- set for custom pins
  created_at timestamptz default now(),
  unique (osm_type, osm_id)
);
create index places_centroid_gix on places using gist (centroid);
create index places_boundary_gix on places using gist (boundary);

-- Memoized containment (place → all ancestors, ordered)
create table place_ancestry (
  place_id uuid references places on delete cascade,
  ancestor_id uuid references places on delete cascade,
  depth smallint not null,                -- 1 = immediate parent
  primary key (place_id, ancestor_id)
);

-- One chat per place, created lazily on first message
create table chats (
  id uuid primary key default gen_random_uuid(),
  place_id uuid unique not null references places on delete cascade,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats on delete cascade,
  author_id uuid not null references auth.users,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now()
);
create index messages_chat_time on messages (chat_id, created_at desc);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz default now()
);
```

RLS policy intent (write the actual policies):
- `places`, `place_ancestry`, `chats`, `messages`: **readable by everyone including anonymous** (the world map is public).
- `messages` insert: authenticated users only, `author_id = auth.uid()`.
- `places` insert (custom pins): authenticated users only, `kind = 'custom'`, `created_by = auth.uid()`.
- No updates/deletes in v1 except: users may delete their own messages.

Containment query (put in a Postgres function `compute_ancestry(place uuid)`):
```sql
-- ancestors = all places whose boundary contains this place's centroid,
-- excluding itself, ordered by admin specificity (finer admin_level = closer parent)
select p2.id
from places p1, places p2
where p1.id = $1
  and p2.boundary is not null
  and p2.id <> p1.id
  and st_covers(p2.boundary::geometry, p1.centroid::geometry)
order by p2.admin_level desc nulls last;
```
Call it after hydration, write results into `place_ancestry`. If an ancestor at an expected level (city, state, country) is missing from the DB, hydrate it (§4) before finalizing ancestry.

## 4. OSM hydration pipeline (`/lib/geo/hydrate.ts` + `/app/api/geo/hydrate`)

When a user selects a map feature that isn't in `places` yet:

1. Client sends `{ osm_type, osm_id, name, lngLat }` (MapLibre's `queryRenderedFeatures` exposes OSM IDs in OpenFreeMap tiles — verify the exact property name in the tile schema and document it in ARCHITECTURE.md).
2. Server route fetches the feature from Overpass API: tags, centroid, and (for relations/ways with `boundary=administrative` or closed geometry) the polygon. Simplify polygons server-side with `ST_SimplifyPreserveTopology` before storing if they exceed ~10k points.
3. Map OSM tags → `kind` (write a single pure function `classifyOsmTags()` with unit tests: `admin_level 2 → country`, `4 → state`, `6 → county`, `8 → city`, `9–10 → neighborhood`, `place=suburb/neighbourhood → neighborhood`, everything with a name and no admin role → `poi`).
4. Upsert into `places` (idempotent on `(osm_type, osm_id)`), run `compute_ancestry`, hydrating missing ancestors recursively via Nominatim reverse geocoding (`zoom` parameter per level) — cap recursion at 6 levels.
5. Return the place + ancestry to the client in a single payload.

Rate limiting: in-memory token bucket per IP on the hydrate route (10/min). Cache Overpass responses in a `osm_cache` table (raw JSON, 30-day TTL).

Custom pins skip Overpass: user long-presses the map → names the pin → insert with `kind='custom'` → ancestry computed the same way.

## 5. Map interaction spec (`/components/map`)

- Full-viewport MapLibre canvas. No header bar over the map — controls float.
- **Tap a rendered feature** (POI label, building, area label) → hydrate if needed → open place sheet.
- **Tap an area label** (e.g., the "Brentwood" text on the map) selects the *area*, not a point. Area labels are first-class targets.
- **Long-press empty space** → "Create a place here" flow (auth-gated).
- When a place with a boundary is selected, render its polygon as a subtle outline layer (see aesthetic §7 — the "surveyed parcel" treatment).
- **Place sheet**: bottom sheet on mobile (drag between peek/half/full), 400px right-hand panel on desktop. Map stays live and pannable behind/beside it. Sheet contains: place name + kind label, breadcrumb of ancestors, chat (message list + composer), member/message count.
- **Breadcrumb hop**: tapping an ancestor animates `fitBounds` to that ancestor's boundary AND swaps the sheet content. The camera move and the content swap must feel like one gesture.
- URL state: `/p/[placeId]` deep-links to a selected place with camera fitted. The map root is `/`. Back button walks selection history.
- Keyboard: `Esc` closes sheet, `/` focuses search (search = Nominatim, results are hydratable places).

## 6. Chat spec (`/components/chat`)

- Chat row is created lazily: first message to a place creates its `chats` row (do this in a Postgres function to keep it atomic).
- Supabase Realtime subscription on `messages` filtered by `chat_id`. Optimistic insert on send; reconcile on ack.
- Message list: reverse-infinite scroll, 50 per page, grouped by author within 5-minute windows, day dividers.
- Anonymous users see the chat read-only with a single inline sign-in affordance in the composer slot ("Sign in to talk here"). Never a modal wall.
- Empty chat state copy (exact): "No one has said anything in {PLACE NAME} yet." + composer. That's the whole empty state.
- v1 moderation floor: author can delete own message; hard length cap; server-side rate limit of 1 message/sec per user. Add a `reports` table (message_id, reporter, reason) with insert-only RLS — no UI beyond a "Report" item in the message menu.

## 7. Aesthetic system — "The Survey" (this section overrides all default styling instincts)

**Explicitly banned** (these read as AI-generated): purple/indigo gradients; glassmorphism/backdrop-blur cards; Inter/Poppins/generic geometric sans; `rounded-2xl` + soft-shadow card grids; emoji as UI icons; cream background + high-contrast serif + terracotta accent; near-black background with one acid-green accent; hero sections with big number + small label + gradient. Also banned: shadcn default look left unthemed.

**Direction instead:** the interface is an instrument, styled like the artifacts of real cartography — survey documents, nautical charts, gazetteers. Flat ink on paper. Precision over softness.

Tokens (define as CSS custom properties, consume via Tailwind theme):

```
--paper:    #F7F5EF   /* chart paper — UI surfaces (the map itself provides color) */
--ink:      #1A1A18   /* near-black ink — text, borders */
--water:    #3B6FA0   /* hydrographic blue — links, active states */
--magenta:  #C2187A   /* chart magenta — the accent. Real nautical charts print
                         critical notices in magenta; here it marks the selected
                         place, unread activity, and primary actions. Use sparingly. */
--contour:  #B8B2A3   /* faded contour gray — dividers, secondary text, hairlines */
```

Type (all via Google Fonts / Fontsource):
- **UI + body: Archivo** — a grotesque with cartographic-signage DNA. Use width/weight axes: Archivo Expanded, uppercase, letterspaced for place-kind labels ("NEIGHBORHOOD", "COUNTRY") — these are the map-legend voice.
- **Place names: Newsreader Italic** at display sizes — the serif-italic convention real maps use for water bodies and regions. A place sheet headed by "Brentwood" in Newsreader italic over an Archivo-caps kind label is the identity in one glance.
- **Coordinates, counts, timestamps: IBM Plex Mono** — the instrument-readout voice.

Component language:
- 0–2px border radius everywhere. Hairline `--contour` borders instead of drop shadows. If elevation is needed, use a solid 1px `--ink` border + 2px offset flat shadow (printed-card look), never a blur.
- The **signature element**: when a place is selected, its boundary renders on the map as a fine `--magenta` dashed outline with small tick marks at vertices — a surveyed parcel. The place sheet header shows the place's coordinates and area in Plex Mono like a legend entry. This one element carries the identity; keep everything else quiet.
- Buttons: rectangular, 1px ink border, paper fill; primary action = magenta fill, paper text. Active/hover states shift border weight, not color washes.
- Motion: fast and mechanical (120–180ms, ease-out), only on sheet transitions and camera moves. `prefers-reduced-motion` respected. No scroll-triggered reveals, no floating blobs, nothing ambient.
- Base map style: start from OpenFreeMap Liberty, then override to a desaturated variant so the magenta selection and ink UI sit on top clearly. Keep water recognizably blue.
- Accessibility floor: visible 2px ink focus rings, WCAG AA contrast on all token pairs (verify `--magenta` on `--paper` for text sizes; use it ≥18px or bold), full keyboard operability of sheet + composer.

## 8. Build phases (execute in order)

**Phase 0 — Skeleton.** Next.js + TS + Tailwind + token system + fonts loaded. MapLibre full-viewport map with OpenFreeMap tiles, pan/zoom working, deployed to Vercel. `ARCHITECTURE.md` stub. → Criteria: map renders worldwide at 60fps on a mid-range phone; Lighthouse perf ≥ 90 on the map route.

**Phase 1 — Schema + auth.** Supabase project, migration 0001, RLS policies, magic-link + Google auth, `profiles` with handle claim on first sign-in. → Criteria: RLS verified with anon vs. authed test queries (write these as a script in `/scripts/rls-check.ts`); a second migration can be added and applied cleanly.

**Phase 2 — Select + hydrate.** Tap features → hydration pipeline → place sheet opens with name, kind, coordinates. Custom pin creation via long-press. `classifyOsmTags` unit-tested. → Criteria: tapping a café, a neighborhood label, and a country label each produce a correct `places` row; repeat taps hit the DB, not Overpass.

**Phase 3 — Containment + breadcrumb.** `compute_ancestry`, recursive ancestor hydration, breadcrumb UI, hop-to-ancestor camera animation, `/p/[placeId]` deep links. → Criteria: selecting a Santa Monica café shows Santa Monica → LA County → California → United States, and each hop lands on a working place sheet in <1s from warm cache.

**Phase 4 — Chat.** Lazy chat creation, realtime messages, optimistic send, read-only anonymous view, delete-own, rate limits, reports table. → Criteria: two browsers see each other's messages <500ms; anon can read but not write; RLS check script extended and passing.

**Phase 5 — Polish + open source.** Empty states per §6 copy rules, error states with plain-language recovery, loading skeletons, reduced-motion pass, mobile sheet gesture feel, README with local-dev instructions (Supabase CLI local stack), AGPL license, CONTRIBUTING.md, seed script that hydrates ~20 well-known places for demos. → Criteria: a stranger can clone, run `pnpm dev` with a local Supabase, and select a place within 10 minutes using only the README.

## 9. Explicitly out of scope for v1 (do not build)

Calendars/notes/playlists (the schema's `places`-as-container design already accommodates them later — note this in ARCHITECTURE.md); federation; native apps; push notifications; DMs; image uploads; place editing/merging; moderation dashboards; presence indicators; monetization anything.

## 10. Definition of done for v1

A person on their phone opens the site, pinches from planet Earth down to their street, taps their coffee shop, reads what neighbors said, signs in with one tap, replies, then taps "Los Angeles" in the breadcrumb and says something to the whole city — without the map ever leaving the screen.
