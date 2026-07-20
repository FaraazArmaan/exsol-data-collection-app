-- Migration 164: Product Manager variants with tenant-safe stock and sale snapshot seams.
-- Variants inherit product marketing content; their own fields are sellable overrides.
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  title text NOT NULL,
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku text,
  barcode text,
  price_cents int,
  sale_price_cents int,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  status product_status NOT NULL DEFAULT 'draft',
  availability text NOT NULL DEFAULT 'in_stock',
  pos_visible boolean NOT NULL DEFAULT true,
  storefront_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT product_variants_option_values_object CHECK (jsonb_typeof(option_values) = 'object'),
  CONSTRAINT product_variants_price_nonneg CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT product_variants_sale_price_nonneg CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0),
  CONSTRAINT product_variants_availability_valid CHECK (availability IN ('in_stock','out_of_stock','preorder','discontinued')),
  CONSTRAINT product_variants_id_product_uniq UNIQUE (id, product_id),
  CONSTRAINT product_variants_id_client_product_uniq UNIQUE (id, client_id, product_id)
);
CREATE UNIQUE INDEX product_variants_client_sku_uniq ON public.product_variants (client_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX product_variants_client_barcode_uniq ON public.product_variants (client_id, barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX product_variants_product_title_uniq ON public.product_variants (product_id, title);
CREATE INDEX product_variants_client_product_idx ON public.product_variants (client_id, product_id, status);
CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.inventory_stock ADD COLUMN variant_id uuid;
ALTER TABLE public.stock_movements ADD COLUMN variant_id uuid;
ALTER TABLE public.sale_lines ADD COLUMN variant_id uuid;
ALTER TABLE public.sale_lines ADD COLUMN variant_name_snap text;
ALTER TABLE public.sale_lines ADD COLUMN variant_sku_snap text;
ALTER TABLE public.inventory_stock DROP CONSTRAINT inventory_stock_client_product_uniq;
ALTER TABLE public.inventory_stock ADD CONSTRAINT inventory_stock_variant_parent_fk FOREIGN KEY (variant_id, client_id, product_id) REFERENCES public.product_variants (id, client_id, product_id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_variant_parent_fk FOREIGN KEY (variant_id, client_id, product_id) REFERENCES public.product_variants (id, client_id, product_id) ON DELETE RESTRICT;
ALTER TABLE public.sale_lines ADD CONSTRAINT sale_lines_variant_parent_fk FOREIGN KEY (variant_id, product_id) REFERENCES public.product_variants (id, product_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX inventory_stock_client_product_base_uniq ON public.inventory_stock (client_id, product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX inventory_stock_client_variant_uniq ON public.inventory_stock (client_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX stock_movements_client_variant_idx ON public.stock_movements (client_id, variant_id, created_at DESC) WHERE variant_id IS NOT NULL;
CREATE INDEX sale_lines_variant_idx ON public.sale_lines (variant_id) WHERE variant_id IS NOT NULL;
