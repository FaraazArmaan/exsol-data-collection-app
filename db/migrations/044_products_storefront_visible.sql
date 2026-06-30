-- Migration 044: products.storefront_visible — per-product visibility on the
-- public storefront, distinct from pos_visible (two real surfaces, two flags).
-- Defaults true so enabling the storefront shows the existing menu as-is.
-- The partial index matches the always-true WHERE predicate of the storefront
-- menu query. Additive + idempotent.
-- See docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md §4.2.

alter table public.products
  add column if not exists storefront_visible boolean not null default true;

create index if not exists idx_products_client_storefront_visible
  on public.products (client_id, storefront_visible)
  where storefront_visible = true and deleted_at is null;
