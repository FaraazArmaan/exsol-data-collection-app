-- Migration 060: Marketing Automation (campaigns + per-recipient send log)
-- Spec: docs/superpowers/specs/2026-07-04-marketing-automation-design.md
-- Reserved number 060 (free on main; gap before 061). Depends on 055 (crm_customers).
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  subject text not null,
  body_html text not null,
  audience text not null default 'all' check (audience in ('all', 'recent_30d')),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at timestamptz,
  created_by_user_node uuid references public.user_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_campaigns_client_created_idx on public.marketing_campaigns (client_id, created_at desc);
create table if not exists public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  customer_id uuid references public.crm_customers(id) on delete set null,
  recipient_email text not null,
  status text not null check (status in ('sent', 'logged', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id);
create index if not exists campaign_sends_client_created_idx on public.campaign_sends (client_id, created_at desc);
