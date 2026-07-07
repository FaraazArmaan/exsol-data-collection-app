-- Migration 136: Social scheduler — compose + schedule posts to a provider seam.
-- Providers are mock until real keys land; a scheduled function posts due rows.
create table if not exists public.marketing_social_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null check (provider in ('facebook', 'instagram', 'x', 'linkedin')),
  content text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'posted', 'failed', 'cancelled')),
  posted_at timestamptz,
  provider_ref text,
  error text,
  created_by_user_node uuid references public.user_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_social_posts_client_sched_idx on public.marketing_social_posts (client_id, scheduled_for desc);
create index if not exists marketing_social_posts_due_idx on public.marketing_social_posts (status, scheduled_for);
