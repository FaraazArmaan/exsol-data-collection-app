-- Migration 050: brand_* columns on public.clients.
-- Workspace-level branding namespace (ADR-0001): logos, hero carousel, accent,
-- theme, fonts. Consumed by every customer-facing surface via BrandShell.
-- Additive + idempotent. No data migration (POS v3 unmerged).
-- See docs/superpowers/specs/2026-07-01-platform-branding-design.md.

alter table public.clients
  add column if not exists brand_logo_key       text,
  add column if not exists brand_logo_alt_key   text,
  add column if not exists brand_favicon_key    text,
  add column if not exists brand_app_icon_key   text,
  add column if not exists brand_social_key     text,
  add column if not exists brand_hero_keys      text[]  not null default '{}',
  add column if not exists brand_accent         text,
  add column if not exists brand_theme          text    not null default 'dark',
  add column if not exists brand_font_heading   text,
  add column if not exists brand_font_body      text;

alter table public.clients
  drop constraint if exists clients_brand_theme_chk;

alter table public.clients
  add constraint clients_brand_theme_chk check (brand_theme in ('dark','light'));
