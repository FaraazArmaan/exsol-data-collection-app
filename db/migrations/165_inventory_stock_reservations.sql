-- Migration 165: variant-aware stock reservations for pending sales.
ALTER TABLE public.inventory_stock ADD COLUMN qty_reserved int NOT NULL DEFAULT 0;
ALTER TABLE public.inventory_stock ADD CONSTRAINT inventory_stock_reserved_nonneg CHECK (qty_reserved >= 0 AND qty_reserved <= qty_on_hand);
CREATE TYPE inventory_reservation_status AS ENUM ('reserved', 'released', 'consumed');
CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  sale_line_id uuid NOT NULL REFERENCES public.sale_lines(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid,
  qty int NOT NULL CHECK (qty > 0),
  status inventory_reservation_status NOT NULL DEFAULT 'reserved',
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservations_sale_line_uniq UNIQUE (sale_line_id),
  CONSTRAINT inventory_reservations_variant_parent_fk FOREIGN KEY (variant_id, client_id, product_id) REFERENCES public.product_variants (id, client_id, product_id) ON DELETE RESTRICT
);
CREATE INDEX inventory_reservations_sale_status_idx ON public.inventory_reservations (sale_id, status);
CREATE INDEX inventory_reservations_client_stock_idx ON public.inventory_reservations (client_id, product_id, variant_id, status);
