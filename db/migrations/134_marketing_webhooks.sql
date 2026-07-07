-- Migration 134: Webhook spine — signed inbound webhooks → events → triggers.
-- Each client registers an endpoint (per-tenant token + HMAC secret); the
-- receiver resolves the tenant from the token, never the payload. A trigger maps
-- an event_type to a campaign, sent 1:1 to the recipient named in the payload.
create table if not exists public.marketing_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null,
  token text not null unique,
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists marketing_webhook_endpoints_client_idx on public.marketing_webhook_endpoints (client_id);
create table if not exists public.marketing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  endpoint_id uuid references public.marketing_webhook_endpoints(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  triggered_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists marketing_webhook_events_client_created_idx on public.marketing_webhook_events (client_id, created_at desc);
create table if not exists public.marketing_webhook_triggers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists marketing_webhook_triggers_lookup_idx on public.marketing_webhook_triggers (client_id, event_type, active);
