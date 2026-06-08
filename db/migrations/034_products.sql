-- Migration 034: products — central catalog row.
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.2.

CREATE TYPE product_type   AS ENUM ('physical', 'service');
CREATE TYPE product_status AS ENUM ('active', 'draft', 'archived');

CREATE TABLE public.products (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type                   product_type NOT NULL,
  name                   text NOT NULL,
  description            text,
  category_id            uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  brand                  text,
  tags                   text[] NOT NULL DEFAULT '{}',
  price_cents            int  NOT NULL,
  currency               text NOT NULL DEFAULT 'USD',
  sku                    text,
  stock_qty              int,
  unit                   text,
  status                 product_status NOT NULL DEFAULT 'draft',
  hero_image_key         text,
  created_by_user_node   uuid REFERENCES public.user_nodes(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT products_type_fields_consistent CHECK (
    (type = 'service'  AND sku IS NULL AND stock_qty IS NULL AND unit IS NULL) OR
    (type = 'physical')
  ),
  CONSTRAINT products_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT products_stock_nonneg CHECK (stock_qty IS NULL OR stock_qty >= 0),
  CONSTRAINT products_name_len     CHECK (char_length(name) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX products_client_sku_idx
  ON public.products (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE INDEX products_client_status_idx
  ON public.products (client_id, status) WHERE deleted_at IS NULL;
CREATE INDEX products_client_category_idx
  ON public.products (client_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_client_created_idx
  ON public.products (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX products_search_idx
  ON public.products USING gin (
    to_tsvector('simple', name || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, ''))
  );

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
