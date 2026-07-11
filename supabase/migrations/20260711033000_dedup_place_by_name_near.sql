-- Gazetteer — dedup reader for hydration.
--
-- OSM often models one real-world place as multiple elements — e.g. Pembroke
-- Pines exists both as a `boundary=administrative` relation and a separate
-- place-label node. Since place identity is (osm_type, osm_id), each element
-- used to hydrate into its own `places` row with its own (empty) chat, so a
-- user's message could "vanish" simply because a later tap resolved a
-- different element for the same city.
--
-- This reader lets hydration check, after Overpass resolves a *new* OSM
-- element's name/kind, whether an existing place already covers the same
-- name+kind nearby — if so, the new element is treated as an alias of it
-- instead of becoming a second row. Server-only (service role calls it from
-- lib/geo/hydrate.ts); no client ever needs this lookup.
create or replace function place_by_name_near(
  p_kind text,
  p_name text,
  p_lng double precision,
  p_lat double precision,
  p_radius_m double precision
)
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
  where kind = p_kind
    and lower(name) = lower(p_name)
    and ST_DWithin(
          centroid,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_m
        )
  order by ST_Distance(centroid, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
  limit 1;
$$;
revoke execute on function place_by_name_near(text, text, double precision, double precision, double precision) from public;
grant execute on function place_by_name_near(text, text, double precision, double precision, double precision) to service_role;
