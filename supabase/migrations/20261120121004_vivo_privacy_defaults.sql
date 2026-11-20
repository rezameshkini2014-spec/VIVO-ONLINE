alter table public.vivo_users alter column is_private set default true;
alter table public.vivo_posts alter column audience set default 'followers';
alter table public.vivo_stories alter column audience set default 'followers';
