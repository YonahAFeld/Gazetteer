-- Gazetteer — Slack-style channels, DMs, threads, reactions (Chat upgrade)
--
-- Turns each place's single flat chat into a place "workspace": a set of
-- channels (#general, #q-and-a, #events + custom), scoped DM threads, threaded
-- replies, and emoji reactions. Interaction patterns are Slack's; the skin stays
-- Gazetteer's (ink-on-paper). See docs/DECISIONS.md.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Channels are scoped to a place. Every place has three default channels,
-- created atomically by a trigger so a place never exists without them.
create table channels (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places on delete cascade,
  slug text not null,
  name text not null,
  kind text not null default 'custom' check (kind in ('default','custom')),
  created_by uuid references auth.users,   -- null for default channels
  created_at timestamptz default now(),
  unique (place_id, slug)
);
create index channels_place on channels (place_id);

-- Per-user read cursor for a channel; drives unread state. A row also stands in
-- for "membership" (created on first open/post), so counting rows ≈ member count.
create table channel_members (
  channel_id uuid not null references channels on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- A 1:1 conversation, scoped to a place: the same two people get a *different*
-- thread in a different shared place (intentional — keeps DMs tied to context).
-- user_a/user_b are stored ordered (least, greatest) so the unique index dedupes.
create table dm_threads (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places on delete cascade,
  user_a uuid not null references auth.users on delete cascade,
  user_b uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  check (user_a < user_b),
  unique (place_id, user_a, user_b)
);
create index dm_threads_place on dm_threads (place_id);

-- Per-user read cursor for a DM thread (mirrors channel_members).
create table dm_thread_members (
  thread_id uuid not null references dm_threads on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- ---------------------------------------------------------------------------
-- messages: extend in place (don't replace). Old rows carry chat_id; new rows
-- carry (parent_type, parent_id). thread_root_id marks a message as a reply.
-- ---------------------------------------------------------------------------
alter table messages
  add column parent_type text check (parent_type in ('channel','dm')),
  add column parent_id uuid,
  add column thread_root_id uuid references messages on delete cascade,
  add column edited_at timestamptz;

-- chat_id becomes optional (new messages are addressed by parent_id).
alter table messages alter column chat_id drop not null;

create index messages_parent_time on messages (parent_type, parent_id, created_at desc);
create index messages_thread on messages (thread_root_id) where thread_root_id is not null;

-- ---------------------------------------------------------------------------
-- reactions: emoji on any message. One (message, user, emoji) is unique.
-- ---------------------------------------------------------------------------
create table reactions (
  message_id uuid not null references messages on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  primary key (message_id, user_id, emoji)
);
create index reactions_message on reactions (message_id);

-- ---------------------------------------------------------------------------
-- Default-channel creation. A single function guarantees the invariant; a
-- trigger fires it on every place insert (hydration *and* custom pins).
-- ---------------------------------------------------------------------------
create or replace function ensure_default_channels(p_place_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into channels (place_id, slug, name, kind)
  values
    (p_place_id, 'general', 'General', 'default'),
    (p_place_id, 'q-and-a', 'Q&A',     'default'),
    (p_place_id, 'events',  'Events',  'default')
  on conflict (place_id, slug) do nothing;
$$;

create or replace function tg_ensure_default_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_default_channels(new.id);
  return new;
end;
$$;

create trigger places_default_channels
  after insert on places
  for each row execute function tg_ensure_default_channels();

-- ---------------------------------------------------------------------------
-- Backfill existing data.
--   1. Give every existing place its three default channels.
--   2. Re-point existing messages at their place's #general channel.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from places loop
    perform ensure_default_channels(r.id);
  end loop;
end $$;

update messages m
set parent_type = 'channel',
    parent_id = gen.id
from chats c
join channels gen on gen.place_id = c.place_id and gen.slug = 'general'
where m.chat_id = c.id
  and m.parent_id is null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table channels          enable row level security;
alter table channel_members   enable row level security;
alter table dm_threads        enable row level security;
alter table dm_thread_members enable row level security;
alter table reactions         enable row level security;

-- channels: public read (the map is public); a member may create a custom
-- channel for themselves. Default channels are created by the trigger only.
create policy channels_select_all on channels
  for select using (true);
create policy channels_insert_custom on channels
  for insert to authenticated
  with check (kind = 'custom' and created_by = auth.uid());

-- channel_members / dm_thread_members: no direct policies. Read cursors are
-- private; all access is through security-definer RPCs (mark_read, place_*).

-- dm_threads: only the two participants can see a thread exists.
create policy dm_threads_select_participant on dm_threads
  for select using (user_a = auth.uid() or user_b = auth.uid());

-- reactions: channel-message reactions are public (also enables Realtime);
-- DM-message reactions are only reachable through the DM reader RPC.
create policy reactions_select_channel on reactions
  for select using (
    exists (
      select 1 from messages m
      where m.id = reactions.message_id and m.parent_type = 'channel'
    )
  );

-- messages: replace the blanket public-read policy so DM content stays private.
-- Channel and legacy messages remain public; DM messages are participant-only.
drop policy if exists messages_select_all on messages;
create policy messages_select_visible on messages
  for select using (
    parent_type is distinct from 'dm'
    or exists (
      select 1 from dm_thread_members dm
      where dm.thread_id = messages.parent_id and dm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: reactions ride alongside messages (already published) so open
-- channels see live reacts. Thread replies are messages, so they already flow.
-- ---------------------------------------------------------------------------
alter table reactions replica identity full;
alter publication supabase_realtime add table reactions;
