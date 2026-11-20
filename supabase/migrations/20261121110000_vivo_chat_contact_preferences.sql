create table if not exists public.vivo_chat_contact_preferences (
  owner_id uuid not null references public.vivo_users(id) on delete cascade,
  contact_user_id uuid not null references public.vivo_users(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) <= 50),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~* '^https://')),
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);
alter table public.vivo_chat_contact_preferences enable row level security;
revoke all on public.vivo_chat_contact_preferences from anon, authenticated;
grant all on public.vivo_chat_contact_preferences to service_role;
