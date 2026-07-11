-- Fix: converting channel_messages to plpgsql (for the velocity-guard gate)
-- brought RETURNS TABLE column names (created_at, ...) into scope as
-- variables, so the two unqualified `created_at`/reactions references that
-- were fine under `language sql` became ambiguous. Same trap documented in
-- 20260710181500_channels_functions_fix.sql — same fix, alias everything.

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
  where m.parent_type = 'channel' and m.parent_id = p_channel_id
    and m.thread_root_id is null
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
end;
$$;
grant execute on function channel_messages(uuid, timestamptz, int) to anon, authenticated;
