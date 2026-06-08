-- Migration 035: product_images — gallery (separate so reorder doesn't bump product.updated_at).
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.3.

CREATE TABLE public.product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  blob_key    text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_images_product_sort_idx
  ON public.product_images (product_id, sort_order);
