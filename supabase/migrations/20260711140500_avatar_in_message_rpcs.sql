-- Gazetteer — thread avatar_url through every reader/writer that already
-- carries `handle`, so the client never needs a second round-trip per author.
--
-- Adding an output column isn't a valid CREATE OR REPLACE (Postgres rejects
-- changing an existing function's return columns), so each one is dropped
-- and recreated with the same body plus one field.

drop function if exists channel_messages(uuid, timestamptz, int);
create function channel_messages(
  p_channel_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
)
returns table (
  id uuid, author_id uuid, handle text, avatar_url text, body text,
  created_at timestamptz, edited_at timestamptz, thread_root_id uuid,
  reply_count int, last_reply_at timestamptz, reactions jsonb
)
language sql
stable
as $$
  select m.id, m.author_id, p.handle, p.avatar_url, m.body,
         m.created_at, m.edited_at, m.thread_root_id,
         (select count(*)::int from messages rc where rc.thread_root_id = m.id) as reply_count,
         (select max(created_at) from messages rc where rc.thread_root_id = m.id) as last_reply_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('emoji', e.emoji, 'count', e.c, 'mine', e.mine) order by e.first_at)
           from (
             select emoji, count(*)::int as c, bool_or(user_id = auth.uid()) as mine, min(created_at) as first_at
             from reactions where message_id = m.id group by emoji
           ) e
         ), '[]'::jsonb) as reactions
  from messages m
  left join profiles p on p.id = m.author_id
  where m.parent_type = 'channel' and m.parent_id = p_channel_id
    and m.thread_root_id is null
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;
grant execute on function channel_messages(uuid, timestamptz, int) to anon, authenticated;

drop function if exists dm_messages(uuid, timestamptz, int);
create function dm_messages(
  p_thread_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
)
returns table (
  id uuid, author_id uuid, handle text, avatar_url text, body text,
  created_at timestamptz, edited_at timestamptz, thread_root_id uuid,
  reply_count int, last_reply_at timestamptz, reactions jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from dm_thread_members dm where dm.thread_id = p_thread_id and dm.user_id = auth.uid()
  ) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  return query
  select m.id, m.author_id, p.handle, p.avatar_url, m.body,
         m.created_at, m.edited_at, m.thread_root_id,
         (select count(*)::int from messages rc where rc.thread_root_id = m.id) as reply_count,
         (select max(rc.created_at) from messages rc where rc.thread_root_id = m.id) as last_reply_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('emoji', e.emoji, 'count', e.c, 'mine', e.mine) order by e.first_at)
           from (
             select rx.emoji, count(*)::int as c, bool_or(rx.user_id = auth.uid()) as mine, min(rx.created_at) as first_at
             from reactions rx where rx.message_id = m.id group by rx.emoji
           ) e
         ), '[]'::jsonb) as reactions
  from messages m
  left join profiles p on p.id = m.author_id
  where m.parent_type = 'dm' and m.parent_id = p_thread_id
    and m.thread_root_id is null
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
end;
$$;
revoke execute on function dm_messages(uuid, timestamptz, int) from public;
grant execute on function dm_messages(uuid, timestamptz, int) to authenticated;

drop function if exists thread_messages(uuid, timestamptz, int);
create function thread_messages(
  p_root_id uuid,
  p_before timestamptz default null,
  p_limit int default 100
)
returns table (
  id uuid, author_id uuid, handle text, avatar_url text, body text,
  created_at timestamptz, edited_at timestamptz, thread_root_id uuid,
  reply_count int, last_reply_at timestamptz, reactions jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent_type text;
  v_parent_id uuid;
begin
  select m.parent_type, m.parent_id into v_parent_type, v_parent_id
  from messages m where m.id = p_root_id;
  if v_parent_type is null then
    raise exception 'thread not found' using errcode = 'P0002';
  end if;
  if v_parent_type = 'dm' and not exists (
    select 1 from dm_thread_members dm where dm.thread_id = v_parent_id and dm.user_id = auth.uid()
  ) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  return query
  select m.id, m.author_id, p.handle, p.avatar_url, m.body,
         m.created_at, m.edited_at, m.thread_root_id,
         0 as reply_count, null::timestamptz as last_reply_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('emoji', e.emoji, 'count', e.c, 'mine', e.mine) order by e.first_at)
           from (
             select rx.emoji, count(*)::int as c, bool_or(rx.user_id = auth.uid()) as mine, min(rx.created_at) as first_at
             from reactions rx where rx.message_id = m.id group by rx.emoji
           ) e
         ), '[]'::jsonb) as reactions
  from messages m
  left join profiles p on p.id = m.author_id
  where m.thread_root_id = p_root_id
    and (p_before is null or m.created_at < p_before)
  order by m.created_at asc
  limit least(coalesce(p_limit, 100), 200);
end;
$$;
revoke execute on function thread_messages(uuid, timestamptz, int) from public;
grant execute on function thread_messages(uuid, timestamptz, int) to anon, authenticated;

drop function if exists post_message_v2(text, uuid, text, uuid);
create function post_message_v2(
  p_parent_type text,
  p_parent_id uuid,
  p_body text,
  p_thread_root_id uuid default null
)
returns table (
  id uuid, author_id uuid, handle text, avatar_url text, body text,
  created_at timestamptz, edited_at timestamptz, thread_root_id uuid,
  reply_count int, last_reply_at timestamptz, reactions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_avatar text;
  v_recent int;
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_parent_type not in ('channel','dm') then
    raise exception 'bad parent';
  end if;
  if char_length(coalesce(p_body, '')) not between 1 and 2000 then
    raise exception 'message must be 1-2000 characters';
  end if;

  select pr.handle, pr.avatar_url into v_handle, v_avatar from profiles pr where pr.id = v_uid;
  if v_handle is null then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;

  if p_parent_type = 'channel' then
    if not exists (select 1 from channels ch where ch.id = p_parent_id) then
      raise exception 'channel not found' using errcode = 'P0002';
    end if;
  else
    if not exists (
      select 1 from dm_thread_members dm where dm.thread_id = p_parent_id and dm.user_id = v_uid
    ) then
      raise exception 'not a participant' using errcode = '42501';
    end if;
  end if;

  select count(*) into v_recent from messages msg
  where msg.author_id = v_uid and msg.created_at > now() - interval '1 second';
  if v_recent > 0 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into messages (author_id, body, parent_type, parent_id, thread_root_id)
  values (v_uid, p_body, p_parent_type, p_parent_id, p_thread_root_id)
  returning messages.id, messages.created_at into v_id, v_created;

  if p_parent_type = 'channel' then
    insert into channel_members (channel_id, user_id, last_read_at)
    values (p_parent_id, v_uid, now())
    on conflict (channel_id, user_id) do update set last_read_at = now();
  else
    insert into dm_thread_members (thread_id, user_id, last_read_at)
    values (p_parent_id, v_uid, now())
    on conflict (thread_id, user_id) do update set last_read_at = now();
  end if;

  return query
  select v_id, v_uid, v_handle, v_avatar, p_body, v_created, null::timestamptz, p_thread_root_id,
         0, null::timestamptz, '[]'::jsonb;
end;
$$;
revoke execute on function post_message_v2(text, uuid, text, uuid) from public;
grant execute on function post_message_v2(text, uuid, text, uuid) to authenticated;

drop function if exists place_dms(uuid);
create function place_dms(p_place_id uuid)
returns table (
  thread_id uuid, other_id uuid, other_handle text, other_avatar_url text,
  unread boolean, last_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
    case when t.user_a = auth.uid() then t.user_b else t.user_a end as other_id,
    p.handle as other_handle,
    p.avatar_url as other_avatar_url,
    exists (
      select 1 from messages m
      where m.parent_type = 'dm' and m.parent_id = t.id
        and m.author_id <> auth.uid()
        and m.created_at > coalesce(
          (select last_read_at from dm_thread_members
             where thread_id = t.id and user_id = auth.uid()), 'epoch')
    ) as unread,
    (select max(created_at) from messages m
       where m.parent_type = 'dm' and m.parent_id = t.id) as last_at
  from dm_threads t
  left join profiles p
    on p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
  where t.place_id = p_place_id
    and (t.user_a = auth.uid() or t.user_b = auth.uid())
  order by last_at desc nulls last;
$$;
revoke execute on function place_dms(uuid) from public;
grant execute on function place_dms(uuid) to authenticated;

drop function if exists open_dm(uuid, uuid);
create function open_dm(p_place_id uuid, p_other uuid)
returns table (thread_id uuid, other_id uuid, other_handle text, other_avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from profiles where profiles.id = v_uid) then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;
  if p_other = v_uid or p_other is null then
    raise exception 'bad recipient';
  end if;
  if not exists (select 1 from profiles where profiles.id = p_other) then
    raise exception 'recipient has no handle' using errcode = 'P0002';
  end if;

  -- Both participants must have posted in a channel of this place.
  if not exists (
    select 1 from messages m join channels c on c.id = m.parent_id
    where m.parent_type = 'channel' and c.place_id = p_place_id and m.author_id = v_uid
  ) or not exists (
    select 1 from messages m join channels c on c.id = m.parent_id
    where m.parent_type = 'channel' and c.place_id = p_place_id and m.author_id = p_other
  ) then
    raise exception 'both people must have posted here first' using errcode = 'P0001';
  end if;

  v_a := least(v_uid, p_other);
  v_b := greatest(v_uid, p_other);

  insert into dm_threads (place_id, user_a, user_b)
  values (p_place_id, v_a, v_b)
  on conflict (place_id, user_a, user_b) do nothing;

  select dt.id into v_id from dm_threads dt
  where dt.place_id = p_place_id and dt.user_a = v_a and dt.user_b = v_b;

  insert into dm_thread_members (thread_id, user_id) values (v_id, v_a), (v_id, v_b)
  on conflict do nothing;

  return query
  select v_id, p_other,
    (select handle from profiles where profiles.id = p_other),
    (select avatar_url from profiles where profiles.id = p_other);
end;
$$;
revoke execute on function open_dm(uuid, uuid) from public;
grant execute on function open_dm(uuid, uuid) to authenticated;
