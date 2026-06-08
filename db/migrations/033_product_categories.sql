-- Migration 033: product_categories — managed category list per workspace.
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.1.

CREATE TABLE public.product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT product_categories_name_len CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX product_categories_client_name_uniq
  ON public.product_categories (client_id, name) WHERE deleted_at IS NULL;
CREATE INDEX product_categories_client_idx
  ON public.product_categories (client_id) WHERE deleted_at IS NULL;
