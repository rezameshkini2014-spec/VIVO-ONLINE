create extension if not exists pgcrypto;

alter table public.vivo_users
  add column if not exists is_private boolean not null default false,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists last_seen_at timestamptz;

create unique index if not exists vivo_users_username_lower_uidx
  on public.vivo_users (lower(username))
  where username is not null;

alter table public.vivo_chats
  add column if not exists conversation_key text,
  add column if not exists last_message_at timestamptz;

create unique index if not exists vivo_chats_conversation_key_uidx
  on public.vivo_chats (conversation_key)
  where conversation_key is not null;

alter table public.vivo_messages
  add column if not exists sender_id uuid references public.vivo_users(id) on delete set null,
  add column if not exists status text not null default 'sent',
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.vivo_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.vivo_users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2200),
  media jsonb not null default '[]'::jsonb,
  audience text not null default 'public' check (audience in ('public','followers','private')),
  status text not null default 'published' check (status in ('draft','published','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint vivo_posts_body_or_media check (char_length(trim(body)) > 0 or jsonb_array_length(media) > 0)
);

create table if not exists public.vivo_post_likes (
  post_id uuid not null references public.vivo_posts(id) on delete cascade,
  user_id uuid not null references public.vivo_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.vivo_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.vivo_posts(id) on delete cascade,
  author_id uuid not null references public.vivo_users(id) on delete cascade,
  parent_id uuid references public.vivo_comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.vivo_follows (
  follower_id uuid not null references public.vivo_users(id) on delete cascade,
  following_id uuid not null references public.vivo_users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint vivo_follows_no_self check (follower_id <> following_id)
);

create table if not exists public.vivo_stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.vivo_users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  media_path text,
  media_type text not null default 'text' check (media_type in ('text','image','video')),
  background text not null default 'blue',
  audience text not null default 'public' check (audience in ('public','followers','private')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  deleted_at timestamptz,
  constraint vivo_stories_body_or_media check (char_length(trim(body)) > 0 or media_path is not null)
);

create table if not exists public.vivo_story_views (
  story_id uuid not null references public.vivo_stories(id) on delete cascade,
  viewer_id uuid not null references public.vivo_users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table if not exists public.vivo_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.vivo_users(id) on delete cascade,
  actor_id uuid references public.vivo_users(id) on delete set null,
  kind text not null check (kind in ('follow','like','comment','reply','mention','story_reaction','group_invite','message','system')),
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.vivo_blocks (
  blocker_id uuid not null references public.vivo_users(id) on delete cascade,
  blocked_id uuid not null references public.vivo_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint vivo_blocks_no_self check (blocker_id <> blocked_id)
);

create table if not exists public.vivo_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.vivo_users(id) on delete cascade,
  target_type text not null check (target_type in ('user','post','story','comment','message')),
  target_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 2 and 100),
  details text not null default '' check (char_length(details) <= 1500),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.vivo_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.vivo_users(id) on delete cascade,
  bucket_id text not null default 'vivo-media',
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vivo_message_reactions (
  message_id uuid not null references public.vivo_messages(id) on delete cascade,
  user_id uuid not null references public.vivo_users(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction)
);

create index if not exists vivo_posts_feed_idx on public.vivo_posts (created_at desc) where status = 'published' and deleted_at is null;
create index if not exists vivo_posts_author_idx on public.vivo_posts (author_id, created_at desc);
create index if not exists vivo_comments_post_idx on public.vivo_comments (post_id, created_at asc) where deleted_at is null;
create index if not exists vivo_follows_following_idx on public.vivo_follows (following_id, status);
create index if not exists vivo_stories_expiry_idx on public.vivo_stories (expires_at desc) where deleted_at is null;
create index if not exists vivo_notifications_recipient_idx on public.vivo_notifications (recipient_id, created_at desc);
create index if not exists vivo_reports_status_idx on public.vivo_reports (status, created_at asc);
create index if not exists vivo_messages_chat_sent_idx on public.vivo_messages (chat_id, sent_at asc);
create index if not exists vivo_chat_members_user_idx on public.vivo_chat_members (user_id, chat_id);

alter table public.vivo_posts enable row level security;
alter table public.vivo_post_likes enable row level security;
alter table public.vivo_comments enable row level security;
alter table public.vivo_follows enable row level security;
alter table public.vivo_stories enable row level security;
alter table public.vivo_story_views enable row level security;
alter table public.vivo_notifications enable row level security;
alter table public.vivo_blocks enable row level security;
alter table public.vivo_reports enable row level security;
alter table public.vivo_media enable row level security;
alter table public.vivo_message_reactions enable row level security;

revoke all on table public.vivo_posts, public.vivo_post_likes, public.vivo_comments,
  public.vivo_follows, public.vivo_stories, public.vivo_story_views,
  public.vivo_notifications, public.vivo_blocks, public.vivo_reports,
  public.vivo_media, public.vivo_message_reactions
from anon, authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vivo-media', 'vivo-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm','audio/mpeg','audio/ogg','application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = 52428800,
    allowed_mime_types = excluded.allowed_mime_types;
