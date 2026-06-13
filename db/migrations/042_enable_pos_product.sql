-- Migration 042: backfill `pos` for every client that already has `products` enabled.
-- The POS module is a thin shell over the Products module; any client granted
-- `products` should automatically receive `pos` (single grant, two surfaces).
-- Idempotent: `on conflict do nothing` makes re-runs safe.
-- See docs/superpowers/specs/2026-06-12-pos-module-design.md.

insert into public.client_enabled_products (client_id, product_key, enabled_by_admin)
select cep.client_id, 'pos', cep.enabled_by_admin
from public.client_enabled_products cep
where cep.product_key = 'products'
on conflict (client_id, product_key) do nothing;
