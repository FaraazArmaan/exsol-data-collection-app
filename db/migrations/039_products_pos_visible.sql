-- Migration 039: products.pos_visible — POS catalog visibility flag.
-- POS chat owns this canonical version; PM chat may ship an equivalent variant
-- under the same number. `IF NOT EXISTS` everywhere keeps either order safe.
-- See docs/superpowers/specs/2026-06-12-pos-module-design.md §menu-endpoint.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pos_visible boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_client_pos_visible
  ON public.products (client_id, pos_visible)
  WHERE pos_visible = true AND deleted_at IS NULL;
