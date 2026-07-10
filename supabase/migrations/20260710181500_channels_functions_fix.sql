-- Gazetteer — fix column/OUT-parameter ambiguity in the workspace RPCs.
--
-- In plpgsql, RETURNS TABLE column names (handle, author_id, created_at,
-- reactions, …) are in scope as variables, so unqualified references to
-- like-named table columns raise "column reference is ambiguous". Alias the
-- tables so every reference is unambiguous.

create or replace function post_message_v2(
  p_parent_type text,
  p_parent_id uuid,
  p_body text,
  p_thread_root_id uuid default null
)
returns table (
  id uuid, author_id uuid, handle text, body text,
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

  select pr.handle into v_handle from profiles pr where pr.id = v_uid;
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
  select v_id, v_uid, v_handle, p_body, v_created, null::timestamptz, p_thread_root_id,
         0, null::timestamptz, '[]'::jsonb;
end;
$$;
revoke execute on function post_message_v2(text, uuid, text, uuid) from public;
grant execute on function post_message_v2(text, uuid, text, uuid) to authenticated;

create or replace function toggle_reaction(p_message_id uuid, p_emoji text)
returns table (message_id uuid, reactions jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_parent_type text;
  v_parent_id uuid;
  v_existing boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(coalesce(p_emoji, '')) between 1 and 16 is not true then
    raise exception 'bad emoji';
  end if;

  select m.parent_type, m.parent_id into v_parent_type, v_parent_id
  from messages m where m.id = p_message_id;
  if v_parent_type is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_parent_type = 'dm' and not exists (
    select 1 from dm_thread_members dm where dm.thread_id = v_parent_id and dm.user_id = v_uid
  ) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  select true into v_existing from reactions rx
  where rx.message_id = p_message_id and rx.user_id = v_uid and rx.emoji = p_emoji;

  if v_existing then
    delete from reactions rx
    where rx.message_id = p_message_id and rx.user_id = v_uid and rx.emoji = p_emoji;
  else
    insert into reactions (message_id, user_id, emoji)
    values (p_message_id, v_uid, p_emoji)
    on conflict do nothing;
  end if;

  return query
  select p_message_id,
    coalesce((
      select jsonb_agg(jsonb_build_object('emoji', e.emoji, 'count', e.c, 'mine', e.mine) order by e.first_at)
      from (
        select rx.emoji, count(*)::int as c, bool_or(rx.user_id = v_uid) as mine, min(rx.created_at) as first_at
        from reactions rx where rx.message_id = p_message_id group by rx.emoji
      ) e
    ), '[]'::jsonb);
end;
$$;
revoke execute on function toggle_reaction(uuid, text) from public;
grant execute on function toggle_reaction(uuid, text) to authenticated;

-- dm_messages / thread_messages are plpgsql, so the reactions subquery's
-- bare `created_at` collided with the OUT parameter. Alias the reactions table.
create or replace function dm_messages(
  p_thread_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
)
returns table (
  id uuid, author_id uuid, handle text, body text,
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
  select m.id, m.author_id, p.handle, m.body,
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

create or replace function thread_messages(
  p_root_id uuid,
  p_before timestamptz default null,
  p_limit int default 100
)
returns table (
  id uuid, author_id uuid, handle text, body text,
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
  select m.id, m.author_id, p.handle, m.body,
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
