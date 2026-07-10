-- Gazetteer — chat posting, reads, and reports (Phase 4)

-- ---------------------------------------------------------------------------
-- reports: insert-only moderation floor (SPEC.md §6). No read UI in v1; only
-- the service role reads. A user can report a message once via the message menu.
-- ---------------------------------------------------------------------------
create table reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages on delete cascade,
  reporter uuid not null references auth.users,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz default now(),
  unique (message_id, reporter)
);
alter table reports enable row level security;
create policy reports_insert_own on reports
  for insert to authenticated
  with check (reporter = auth.uid());

-- ---------------------------------------------------------------------------
-- post_message — atomically get-or-create the place's chat, enforce a 1 msg/sec
-- per-user rate limit, and insert the message (SPEC.md §6). SECURITY DEFINER so
-- it can create the chat row (which has no client insert policy) and post as the
-- caller; execute is limited to authenticated users.
-- ---------------------------------------------------------------------------
create or replace function post_message(p_place_id uuid, p_body text)
returns messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chat_id uuid;
  v_recent int;
  v_msg messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(coalesce(p_body, '')) not between 1 and 2000 then
    raise exception 'message must be 1-2000 characters';
  end if;

  -- The poster must have claimed a handle first.
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;

  -- Rate limit: 1 message / second / user.
  select count(*) into v_recent
  from messages
  where author_id = v_uid and created_at > now() - interval '1 second';
  if v_recent > 0 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Lazily create the chat for this place (idempotent on the unique place_id).
  insert into chats (place_id) values (p_place_id) on conflict (place_id) do nothing;
  select id into v_chat_id from chats where place_id = p_place_id;

  insert into messages (chat_id, author_id, body)
  values (v_chat_id, v_uid, p_body)
  returning * into v_msg;

  return v_msg;
end;
$$;
revoke execute on function post_message(uuid, text) from public;
grant execute on function post_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- chat_messages — recent messages for a place, newest first, with author handle
-- (PostgREST can't embed profiles across the auth.users FK). Public read.
-- `p_before` paginates older messages.
-- ---------------------------------------------------------------------------
create or replace function chat_messages(
  p_place_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
)
returns table (
  id uuid,
  author_id uuid,
  handle text,
  body text,
  created_at timestamptz
)
language sql
stable
as $$
  select m.id, m.author_id, p.handle, m.body, m.created_at
  from chats c
  join messages m on m.chat_id = c.id
  left join profiles p on p.id = m.author_id
  where c.place_id = p_place_id
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast message inserts/deletes so open chats update live.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table messages;
