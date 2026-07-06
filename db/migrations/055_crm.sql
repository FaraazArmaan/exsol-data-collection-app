-- Migration 055: CRM read-model (crm_customers + crm_notes)
-- Spec: docs/superpowers/specs/2026-07-03-crm-module-design.md
-- Reserved number 055; 051-054 reserved for sibling chats and not yet present.
-- The migrate runner applies files individually (scripts/migrate.ts), so the gap is fine.
-- crm_customers is a derived read-model; dedupe_key = normalizePhone|lower(email).
create table if not exists public.crm_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  display_name text not null,
  phone text,
  email text,
  dedupe_key text not null,
  source text not null check (source in ('pos','storefront','booking')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_customers_client_dedupe_idx on public.crm_customers (client_id, dedupe_key);
create index if not exists crm_customers_client_lastseen_idx on public.crm_customers (client_id, last_seen desc);
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  customer_id uuid not null references public.crm_customers(id) on delete cascade,
  body text not null,
  created_by_user_node uuid references public.user_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_notes_customer_idx on public.crm_notes (customer_id);
