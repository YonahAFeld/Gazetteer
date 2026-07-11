-- Gazetteer — profile pictures.
--
-- Storage: a public "avatars" bucket, one object per user at "<uid>/avatar",
-- writable only by that user (path-prefix check on storage.objects). Public
-- read because avatars are shown to anonymous readers too.
--
-- profiles.avatar_url has no direct-write RLS policy (handles are permanent,
-- and we don't want a blanket "update own profile" policy that would also
-- let a client rewrite its own handle). update_avatar() is the one writer,
-- scoped to that single column, mirroring how every other write in this
-- schema goes through a SECURITY DEFINER RPC rather than a table policy.

alter table profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_select_all on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function update_avatar(p_avatar_url text)
returns void
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
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'claim a handle first' using errcode = '42501';
  end if;
  if p_avatar_url is not null and char_length(p_avatar_url) > 2048 then
    raise exception 'bad avatar url';
  end if;

  update profiles set avatar_url = p_avatar_url where id = v_uid;
end;
$$;
revoke execute on function update_avatar(text) from public;
grant execute on function update_avatar(text) to authenticated;
