-- Migration 061: Data Collection — onboarding tokens.
-- An authed user (Product Manager) generates a single-use, expiring token; a
-- guest visits the public /onboard/:token route and uploads a CSV/XLSX that
-- imports products into that client's catalog. The token is opaque + unique;
-- expires_at bounds its life, used_at marks it consumed (single-use).
-- The Catalog Website product needs no schema (it gates on client_enabled_products).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).
-- See docs/superpowers/specs/2026-07-06-data-collection-catalog-design.md.

create table if not exists public.onboard_tokens (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references public.user_nodes(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists onboard_tokens_client_idx
  on public.onboard_tokens (client_id);

-- Catalog Website: tenant contact fields for the public /catalog/:slug CTA
-- (mailto:/tel:). No dedicated catalog migration — it gates on
-- client_enabled_products('catalog') — but the contact-CTA needs somewhere to
-- read a phone/email, and none existed on clients. Additive + nullable.

alter table public.clients
  add column if not exists contact_phone text;

alter table public.clients
  add column if not exists contact_email text;
