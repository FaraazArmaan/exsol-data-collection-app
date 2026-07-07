-- 126_product_bundles.sql — product bundles (a product composed of others).
--
-- A bundle is itself a row in public.products (its own name, price,
-- storefront_visible) that has >= 1 rows here linking it to component products.
-- "Is this product a bundle?" = EXISTS a row with bundle_product_id = it. The
-- bundle's own stock is derived at read time from its components' availability /
-- stock_qty — bundles carry no independent stock number.
--
-- Additive. Depends on public.products.

CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty                  INTEGER NOT NULL DEFAULT 1,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_bundle_items_qty_chk CHECK (qty > 0),
  CONSTRAINT product_bundle_items_no_self_chk CHECK (bundle_product_id <> component_product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_bundle_items_uniq ON public.product_bundle_items (bundle_product_id, component_product_id);

CREATE INDEX IF NOT EXISTS product_bundle_items_bundle_idx ON public.product_bundle_items (bundle_product_id, position);
