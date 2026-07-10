-- Realtime DELETE events filter on chat_id, which is not in the default replica
-- identity (primary key only). FULL includes the old row so deletions propagate.
alter table messages replica identity full;
