create table if not exists public.vivo_contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.vivo_users(id) on delete cascade,
  recipient_id uuid not null references public.vivo_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint vivo_contact_requests_no_self check (requester_id <> recipient_id),
  constraint vivo_contact_requests_pair_unique unique (requester_id, recipient_id)
);

create index if not exists vivo_contact_requests_recipient_pending_idx
  on public.vivo_contact_requests (recipient_id, created_at desc) where status = 'pending';
create index if not exists vivo_contact_requests_requester_idx
  on public.vivo_contact_requests (requester_id, created_at desc);

alter table public.vivo_contact_requests enable row level security;
revoke all on table public.vivo_contact_requests from anon, authenticated;

create unique index if not exists vivo_contact_requests_pair_undirected_uidx
  on public.vivo_contact_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
