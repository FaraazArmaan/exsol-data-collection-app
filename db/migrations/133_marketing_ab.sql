-- Migration 133: A/B testing + open/click tracking.
-- subject stays variant A; subject_b is variant B. ab_split = % of audience → A.
-- marketing_campaign_events records per-send opens/clicks (pixel + tracked links).
-- Each statement on ONE line (splitter cuts on `;` at end-of-line only).
alter table public.marketing_campaigns add column if not exists is_ab boolean not null default false;
alter table public.marketing_campaigns add column if not exists subject_b text;
alter table public.marketing_campaigns add column if not exists ab_split integer not null default 50;
alter table public.marketing_campaigns add constraint marketing_campaigns_ab_split_range check (ab_split between 0 and 100);
alter table public.campaign_sends add column if not exists variant text;
alter table public.campaign_sends add constraint campaign_sends_variant_valid check (variant is null or variant in ('A','B'));
create table if not exists public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  send_id uuid references public.campaign_sends(id) on delete set null,
  kind text not null check (kind in ('open', 'click')),
  url text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_campaign_events_campaign_kind_idx on public.marketing_campaign_events (campaign_id, kind);
create index if not exists marketing_campaign_events_send_idx on public.marketing_campaign_events (send_id);
