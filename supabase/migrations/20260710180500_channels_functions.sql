-- Gazetteer — RPCs for the channels/DMs/threads/reactions workspace.
--
-- Readers for public channel content are SECURITY INVOKER (they lean on RLS).
-- Anything touching DMs or private read-cursors is SECURITY DEFINER with an
-- explicit participant check, so DM content never leaks through a reader.
--
-- Message readers and post/edit all return the same row shape so the client can
-- reconcile uniformly:
--   id, author_id, handle, body, created_at, edited_at, thread_root_id,
--   reply_count, last_reply_at, reactions(jsonb: [{emoji,count,mine}])

-- ---------------------------------------------------------------------------
-- Place rail: channels (with unread + member count) and DMs.
-- ---------------------------------------------------------------------------
create or replace function place_channels(p_place_id uuid)
returns table (
  id uuid, slug text, name text, kind text,
  unread boolean, member_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.slug, c.name, c.kind,
    (auth.uid() is not null and exists (
      select 1 from messages m
      where m.parent_type = 'channel' and m.parent_id = c.id
        and m.thread_root_id is null
        and m.author_id <> auth.uid()
        and m.created_at > coalesce(
          (select last_read_at from channel_members
             where channel_id = c.id and user_id = auth.uid()), 'epoch')
    )) as unread,
    (select count(*)::int from channel_members cm where cm.channel_id = c.id) as member_count
  from channels c
  where c.place_id = p_place_id
  order by (c.kind = 'default') desc,
    case c.slug when 'general' then 0 when 'q-and-a' then 1 when 'events' then 2 else 99 end,
    c.name;
$$;
revoke execute on function place_channels(uuid) from public;
grant execute on function place_channels(uuid) to anon, authenticated;

create or replace function place_dms(p_place_id uuid)
returns table (
  thread_id uuid, other_id uuid, other_handle text,
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

-- ---------------------------------------------------------------------------
-- Message readers.
-- ---------------------------------------------------------------------------
create or replace function channel_messages(
  p_channel_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
)
returns table (
  id uuid, author_id uuid, handle text, body text,
  created_at timestamptz, edited_at timestamptz, thread_root_id uuid,
  reply_count int, last_reply_at timestamptz, reactions jsonb
)
language sql
stable
as $$
  select m.id, m.author_id, p.handle, m.body,
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
    select 1 from dm_thread_members where thread_id = p_thread_id and user_id = auth.uid()
  ) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  return query
  select m.id, m.author_id, p.handle, m.body,
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
  where m.parent_type = 'dm' and m.parent_id = p_thread_id
    and m.thread_root_id is null
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
end;
$$;
revoke execute on function dm_messages(uuid, timestamptz, int) from public;
grant execute on function dm_messages(uuid, timestamptz, int) to authenticated;

-- Thread replies for a root message (works for channel or DM roots). Visibility
-- follows the root's parent: DM threads require participation.
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
  select parent_type, parent_id into v_parent_type, v_parent_id
  from messages where id = p_root_id;
  if v_parent_type is null then
    raise exception 'thread not found' using errcode = 'P0002';
  end if;
  if v_parent_type = 'dm' and not exists (
    select 1 from dm_thread_members where thread_id = v_parent_id and user_id = auth.uid()
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
             select emoji, count(*)::int as c, bool_or(user_id = auth.uid()) as mine, min(created_at) as first_at
             from reactions where message_id = m.id group by emoji
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

-- ---------------------------------------------------------------------------
-- Posting. One entry point for channel and DM; thread_root_id makes it a reply.
-- ---------------------------------------------------------------------------
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

  select handle into v_handle from profiles where id = v_uid;
  if v_handle is null then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;

  -- Authorization for the target parent.
  if p_parent_type = 'channel' then
    if not exists (select 1 from channels where id = p_parent_id) then
      raise exception 'channel not found' using errcode = 'P0002';
    end if;
  else
    if not exists (
      select 1 from dm_thread_members where thread_id = p_parent_id and user_id = v_uid
    ) then
      raise exception 'not a participant' using errcode = '42501';
    end if;
  end if;

  -- Rate limit: 1 message / second / user.
  select count(*) into v_recent from messages
  where author_id = v_uid and created_at > now() - interval '1 second';
  if v_recent > 0 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into messages (author_id, body, parent_type, parent_id, thread_root_id)
  values (v_uid, p_body, p_parent_type, p_parent_id, p_thread_root_id)
  returning messages.id, messages.created_at into v_id, v_created;

  -- Advance the author's own read cursor / register membership.
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

-- ---------------------------------------------------------------------------
-- Edit own message.
-- ---------------------------------------------------------------------------
create or replace function edit_message(p_message_id uuid, p_body text)
returns table (id uuid, body text, edited_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(coalesce(p_body, '')) not between 1 and 2000 then
    raise exception 'message must be 1-2000 characters';
  end if;
  return query
  update messages m set body = p_body, edited_at = now()
  where m.id = p_message_id and m.author_id = v_uid
  returning m.id, m.body, m.edited_at;
  if not found then
    raise exception 'not your message' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function edit_message(uuid, text) from public;
grant execute on function edit_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reactions: toggle one emoji on a message; returns the message's full reaction
-- set so the client can reconcile. Visibility of the message is enforced.
-- ---------------------------------------------------------------------------
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

  select parent_type, parent_id into v_parent_type, v_parent_id
  from messages where id = p_message_id;
  if v_parent_type is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_parent_type = 'dm' and not exists (
    select 1 from dm_thread_members where thread_id = v_parent_id and user_id = v_uid
  ) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  select true into v_existing from reactions
  where reactions.message_id = p_message_id and user_id = v_uid and emoji = p_emoji;

  if v_existing then
    delete from reactions
    where reactions.message_id = p_message_id and user_id = v_uid and emoji = p_emoji;
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
        select emoji, count(*)::int as c, bool_or(user_id = v_uid) as mine, min(created_at) as first_at
        from reactions where reactions.message_id = p_message_id group by emoji
      ) e
    ), '[]'::jsonb);
end;
$$;
revoke execute on function toggle_reaction(uuid, text) from public;
grant execute on function toggle_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read cursors.
-- ---------------------------------------------------------------------------
create or replace function mark_read(p_parent_type text, p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if p_parent_type = 'channel' then
    insert into channel_members (channel_id, user_id, last_read_at)
    values (p_parent_id, v_uid, now())
    on conflict (channel_id, user_id) do update set last_read_at = now();
  elsif p_parent_type = 'dm' then
    if exists (select 1 from dm_thread_members where thread_id = p_parent_id and user_id = v_uid) then
      update dm_thread_members set last_read_at = now()
      where thread_id = p_parent_id and user_id = v_uid;
    end if;
  end if;
end;
$$;
revoke execute on function mark_read(text, uuid) from public;
grant execute on function mark_read(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Create a custom channel for a place (any member with a handle).
-- ---------------------------------------------------------------------------
create or replace function create_channel(p_place_id uuid, p_name text)
returns table (id uuid, slug text, name text, kind text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text;
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_uid is null or not exists (select 1 from profiles where profiles.id = v_uid) then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'channel name must be 1-40 characters';
  end if;
  v_slug := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug = '' then
    raise exception 'channel name needs letters or numbers';
  end if;

  insert into channels (place_id, slug, name, kind, created_by)
  values (p_place_id, v_slug, v_name, 'custom', v_uid)
  on conflict (place_id, slug) do nothing;

  return query
  select c.id, c.slug, c.name, c.kind from channels c
  where c.place_id = p_place_id and c.slug = v_slug;
end;
$$;
revoke execute on function create_channel(uuid, text) from public;
grant execute on function create_channel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Open (or fetch) a DM thread with another user, scoped to a place. Both users
-- must have posted in this place's channels (SPEC §3 scoping rule).
-- ---------------------------------------------------------------------------
create or replace function open_dm(p_place_id uuid, p_other uuid)
returns table (thread_id uuid, other_id uuid, other_handle text)
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
  select v_id, p_other, (select handle from profiles where profiles.id = p_other);
end;
$$;
revoke execute on function open_dm(uuid, uuid) from public;
grant execute on function open_dm(uuid, uuid) to authenticated;
