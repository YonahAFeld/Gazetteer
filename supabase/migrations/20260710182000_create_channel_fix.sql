-- Gazetteer — fix create_channel ambiguity.
-- The ON CONFLICT (place_id, slug) target read `slug` as the OUT parameter.
-- #variable_conflict use_column resolves bare identifiers to columns (this
-- function never reads the OUT vars), and refs are qualified for clarity.

create or replace function create_channel(p_place_id uuid, p_name text)
returns table (id uuid, slug text, name text, kind text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_slug text;
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from profiles pr where pr.id = v_uid) then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'channel name must be 1-40 characters';
  end if;
  v_slug := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug = '' then
    raise exception 'channel name needs letters or numbers';
  end if;

  select c.id into v_id from channels c where c.place_id = p_place_id and c.slug = v_slug;
  if v_id is null then
    insert into channels (place_id, slug, name, kind, created_by)
    values (p_place_id, v_slug, v_name, 'custom', v_uid)
    on conflict (place_id, slug) do nothing;
    select c.id into v_id from channels c where c.place_id = p_place_id and c.slug = v_slug;
  end if;

  return query
  select c.id, c.slug, c.name, c.kind from channels c where c.id = v_id;
end;
$$;
revoke execute on function create_channel(uuid, text) from public;
grant execute on function create_channel(uuid, text) to authenticated;
