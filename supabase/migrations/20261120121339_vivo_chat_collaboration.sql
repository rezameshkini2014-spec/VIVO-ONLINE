alter table public.vivo_chat_members add column if not exists is_muted boolean not null default false;
alter table public.vivo_chats add column if not exists is_archived boolean not null default false;
create index if not exists vivo_messages_sender_idx on public.vivo_messages (sender_id, sent_at desc);
revoke all on table public.vivo_config, public.vivo_users, public.vivo_chats, public.vivo_chat_members, public.vivo_messages, public.vivo_contacts from anon, authenticated;
