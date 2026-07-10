-- Gazetteer — OSM cache + hydration upsert (Phase 2)

-- ---------------------------------------------------------------------------
-- Raw Overpass responses, cached with a 30-day TTL (SPEC.md §4).
-- Server-only: no RLS policies, so only the service role can read/write it.
-- ---------------------------------------------------------------------------
create table osm_cache (
  osm_type text not null,
  osm_id bigint not null,
  raw jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (osm_type, osm_id)
);
alter table osm_cache enable row level security;

-- ---------------------------------------------------------------------------
-- hydrate_place — idempotent upsert of a resolved OSM element into `places`.
--
-- Called by the trusted server (service role) after Overpass resolution. Keeps
-- all PostGIS geometry handling in SQL: builds the centroid from lng/lat, and
-- (when a boundary GeoJSON is supplied, Phase 3+) simplifies oversized polygons
-- with ST_SimplifyPreserveTopology and stores them as multipolygon geography.
--
-- INVOKER security: it runs with the caller's rights. The service role bypasses
-- RLS, so it can upsert any kind; anon/authenticated cannot call it at all
-- (execute is revoked below), so it can't be used to sidestep the custom-only
-- insert policy on `places`.
-- ---------------------------------------------------------------------------
create or replace function hydrate_place(
  p_osm_type text,
  p_osm_id bigint,
  p_kind text,
  p_name text,
  p_lng double precision,
  p_lat double precision,
  p_admin_level smallint default null,
  p_boundary_geojson text default null
) returns places
language plpgsql
as $$
declare
  result places;
  geom geometry;
begin
  if p_boundary_geojson is not null then
    geom := ST_GeomFromGeoJSON(p_boundary_geojson);
    -- Simplify only very dense polygons (SPEC.md §4.2, ~10k point threshold).
    if ST_NPoints(geom) > 10000 then
      geom := ST_SimplifyPreserveTopology(geom, 0.0005);
    end if;
    geom := ST_Multi(geom);
  end if;

  insert into places (osm_type, osm_id, kind, name, centroid, boundary, admin_level)
  values (
    p_osm_type,
    p_osm_id,
    p_kind,
    p_name,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    case when geom is null then null else geom::geography end,
    p_admin_level
  )
  on conflict (osm_type, osm_id) do update
    set name        = excluded.name,
        kind        = excluded.kind,
        centroid    = excluded.centroid,
        boundary    = coalesce(excluded.boundary, places.boundary),
        admin_level = excluded.admin_level
  returning * into result;

  return result;
end;
$$;

revoke execute on function hydrate_place(
  text, bigint, text, text, double precision, double precision, smallint, text
) from public;
grant execute on function hydrate_place(
  text, bigint, text, text, double precision, double precision, smallint, text
) to service_role;
