-- Migration 135: GDPR toolbox — consent log + erasure audit trail.
-- Export/erase operate on existing tables (crm_customers, crm_notes, sales,
-- bookings, campaign_sends) keyed by email; these two tables are the new state.
create table if not exists public.marketing_consent_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'all')),
  granted boolean not null,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_consent_log_client_email_idx on public.marketing_consent_log (client_id, lower(email), created_at desc);
create table if not exists public.marketing_erasure_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  requested_by_user_node uuid references public.user_nodes(id) on delete set null,
  affected jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketing_erasure_log_client_created_idx on public.marketing_erasure_log (client_id, created_at desc);
