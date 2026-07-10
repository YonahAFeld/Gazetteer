-- Gazetteer — initial schema (Phase 1)
-- Source of truth for the database. Never edit schema from the dashboard;
-- every change is a new numbered migration file (SPEC.md §2.4).

-- PostGIS powers containment ("what contains this point?") — SPEC.md §3.
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Every selectable container in the world. Identity is (osm_type, osm_id) for
-- OSM-derived places, or the uuid for custom pins (SPEC.md §2.1).
create table places (
  id uuid primary key default gen_random_uuid(),
  osm_type text check (osm_type in ('node','way','relation')), -- null for custom pins
  osm_id bigint,                                                -- null for custom pins
  kind text not null check (kind in (
    'poi','building','neighborhood','locality','city','county','state','country','custom'
  )),
  name text not null,
  centroid geography(point, 4326) not null,
  boundary geography(multipolygon, 4326),  -- null for point-only places
  admin_level smallint,                     -- from OSM, drives hierarchy ordering
  created_by uuid references auth.users,    -- set for custom pins
  created_at timestamptz default now(),
  unique (osm_type, osm_id)
);
create index places_centroid_gix on places using gist (centroid);
create index places_boundary_gix on places using gist (boundary);

-- Memoized containment: place -> all ancestors, ordered (SPEC.md §3).
create table place_ancestry (
  place_id uuid references places on delete cascade,
  ancestor_id uuid references places on delete cascade,
  depth smallint not null,                  -- 1 = immediate parent
  primary key (place_id, ancestor_id)
);
create index place_ancestry_place on place_ancestry (place_id, depth);

-- One chat per place, created lazily on first message (SPEC.md §6).
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

-- ---------------------------------------------------------------------------
-- Containment (SPEC.md §3)
--
-- Ancestors = all places whose boundary covers this place's centroid, excluding
-- itself, ordered by admin specificity: a finer (higher) admin_level is a closer
-- parent, so depth 1 (immediate parent) is the highest admin_level.
-- ---------------------------------------------------------------------------

create or replace function compute_ancestry(place uuid)
returns table (ancestor_id uuid, depth smallint)
language sql
stable
as $$
  select p2.id as ancestor_id,
         row_number() over (order by p2.admin_level desc nulls last)::smallint as depth
  from places p1
  join places p2
    on p2.id <> p1.id
   and p2.boundary is not null
   and st_covers(p2.boundary::geometry, p1.centroid::geometry)
  where p1.id = place
  order by p2.admin_level desc nulls last;
$$;

-- Recompute and persist a place's ancestry. Server calls this after hydration
-- (SPEC.md §3, §4.4). SECURITY DEFINER so it can write place_ancestry (which has
-- no direct-write RLS policy — only this function and the service role touch it).
create or replace function refresh_place_ancestry(place uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from place_ancestry where place_id = place;
  insert into place_ancestry (place_id, ancestor_id, depth)
  select place, ancestor_id, depth from compute_ancestry(place);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (SPEC.md §3 — RLS on from day one)
--
-- The world map is public: places, ancestry, chats, and messages are readable by
-- everyone including anonymous. Writes are auth-gated and self-scoped.
-- ---------------------------------------------------------------------------

alter table places         enable row level security;
alter table place_ancestry enable row level security;
alter table chats          enable row level security;
alter table messages       enable row level security;
alter table profiles       enable row level security;

-- places: public read; authenticated users may add custom pins for themselves.
create policy places_select_all on places
  for select using (true);
create policy places_insert_custom on places
  for insert to authenticated
  with check (kind = 'custom' and created_by = auth.uid());

-- place_ancestry: public read. No direct writes — only refresh_place_ancestry()
-- (security definer) and the service role populate it.
create policy place_ancestry_select_all on place_ancestry
  for select using (true);

-- chats: public read. Created lazily via a security-definer function in Phase 4;
-- no direct client insert policy in v1.
create policy chats_select_all on chats
  for select using (true);

-- messages: public read; authenticated users may post as themselves and delete
-- their own. No updates in v1 (SPEC.md §3).
create policy messages_select_all on messages
  for select using (true);
create policy messages_insert_own on messages
  for insert to authenticated
  with check (author_id = auth.uid());
create policy messages_delete_own on messages
  for delete to authenticated
  using (author_id = auth.uid());

-- profiles: public read (handles are public); a user creates their own profile
-- (handle claim on first sign-in). No updates/deletes in v1.
create policy profiles_select_all on profiles
  for select using (true);
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (id = auth.uid());
