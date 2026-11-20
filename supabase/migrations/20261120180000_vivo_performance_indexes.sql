-- VIVO performance maintenance.
-- Add covering indexes for foreign keys identified by the Supabase database advisor.
-- Drop one exact duplicate username index; the remaining unique index preserves the constraint.

create index if not exists vivo_blocks_blocked_id_idx
  on public.vivo_blocks (blocked_id);

create index if not exists vivo_comments_author_id_idx
  on public.vivo_comments (author_id);

create index if not exists vivo_comments_parent_id_idx
  on public.vivo_comments (parent_id);

create index if not exists vivo_contacts_contact_user_id_idx
  on public.vivo_contacts (contact_user_id);

create index if not exists vivo_media_owner_id_idx
  on public.vivo_media (owner_id);

create index if not exists vivo_message_reactions_user_id_idx
  on public.vivo_message_reactions (user_id);

create index if not exists vivo_notifications_actor_id_idx
  on public.vivo_notifications (actor_id);

create index if not exists vivo_post_likes_user_id_idx
  on public.vivo_post_likes (user_id);

create index if not exists vivo_reports_reporter_id_idx
  on public.vivo_reports (reporter_id);

create index if not exists vivo_stories_author_id_idx
  on public.vivo_stories (author_id);

create index if not exists vivo_story_views_viewer_id_idx
  on public.vivo_story_views (viewer_id);

drop index if exists public.vivo_users_username_lower_uq;
