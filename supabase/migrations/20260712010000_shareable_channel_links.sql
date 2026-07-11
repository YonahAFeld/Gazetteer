-- Gazetteer — shareable channel links: infrastructure only.
--
-- Two independent pieces:
--   1. channel_weekly_activity() — a public, count-only reader for OG-preview
--      descriptions ("12 messages this week"). Never exposes message content.
--   2. A velocity guard on channels: columns + a gate inside channel_messages()
--      that, when enabled, requires sign-in to *read* a channel whose recent
--      message volume exceeds its threshold. Defaults leave every channel
--      unaffected — this is groundwork for later, not a v1 behavior change.

create or replace function channel_weekly_activity(p_channel_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from messages
  where parent_type = 'channel' and parent_id = p_channel_id
    and created_at > now() - interval '7 days';
$$;
grant execute on function channel_weekly_activity(uuid) to anon, authenticated;

alter table channels
  add column if not exists velocity_limit_enabled boolean not null default false,
  add column if not exists velocity_window_minutes int not null default 60,
  add column if not exists velocity_threshold int not null default 200;

-- Same shape/body as the current channel_messages, plus a gate at the top.
-- Recreated (not just replaced) because plpgsql needs a declare block the sql
-- version didn't have.
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
language plpgsql
stable
as $$
declare
  v_gated boolean;
begin
  select (
    c.velocity_limit_enabled
    and auth.uid() is null
    and (
      select count(*) from messages rc2
      where rc2.parent_type = 'channel' and rc2.parent_id = c.id
        and rc2.created_at > now() - (c.velocity_window_minutes || ' minutes')::interval
    ) > c.velocity_threshold
  )
  into v_gated
  from channels c
  where c.id = p_channel_id;

  if v_gated then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;

  return query
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
end;
$$;
grant execute on function channel_messages(uuid, timestamptz, int) to anon, authenticated;
