-- Migration 043: clients.storefront_enabled — opt-in flag for the public
-- guest-checkout storefront (POS v2). Online ordering is a business decision,
-- not a default, so this is false until an L1 Owner turns it on.
-- Additive + idempotent. See docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md §4.1.

alter table public.clients
  add column if not exists storefront_enabled boolean not null default false;
