create table if not exists public.vivo_bots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.vivo_users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 50),
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{3,29}$'),
  about text not null default '' check (char_length(about) <= 120),
  description text not null default '' check (char_length(description) <= 1000),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~* '^https://')),
  commands jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vivo_bots_owner_created_idx on public.vivo_bots(owner_id, created_at desc);
alter table public.vivo_bots enable row level security;
revoke all on public.vivo_bots from anon, authenticated;
grant all on public.vivo_bots to service_role;
