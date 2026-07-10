-- Gazetteer — place readers that project geography to plain lng/lat (Phase 2)
--
-- PostgREST returns PostGIS geography as WKB hex, which is awkward on the
-- client. These reader functions extract centroid coordinates (and, later,
-- boundary GeoJSON) so the app never has to decode WKB. They read only public
-- data, so they are safe for anon/authenticated to call.

-- All places sharing a numeric OSM id (used by the hydration DB-first path so a
-- repeat tap resolves from the DB without touching Overpass).
create or replace function place_by_osm_id(p_osm_id bigint)
returns table (
  id uuid,
  osm_type text,
  osm_id bigint,
  kind text,
  name text,
  admin_level smallint,
  lng double precision,
  lat double precision,
  has_boundary boolean
)
language sql
stable
as $$
  select id, osm_type, osm_id, kind, name, admin_level,
         ST_X(centroid::geometry) as lng,
         ST_Y(centroid::geometry) as lat,
         boundary is not null as has_boundary
  from places
  where osm_id = p_osm_id
  order by created_at;
$$;

-- A single place by primary key, same projection (used by deep links / sheet).
create or replace function place_by_id(p_id uuid)
returns table (
  id uuid,
  osm_type text,
  osm_id bigint,
  kind text,
  name text,
  admin_level smallint,
  lng double precision,
  lat double precision,
  has_boundary boolean
)
language sql
stable
as $$
  select id, osm_type, osm_id, kind, name, admin_level,
         ST_X(centroid::geometry) as lng,
         ST_Y(centroid::geometry) as lat,
         boundary is not null as has_boundary
  from places
  where id = p_id;
$$;
