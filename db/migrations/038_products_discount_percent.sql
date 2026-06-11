-- Migration 038: discount_percent on products.
-- See docs/superpowers/specs/2026-06-11-product-discounts-design.md.
-- Additive; safe to run before or after code deploy. CHECK enforces the
-- exclusive 0..100 range; the column is nullable to preserve Phase B's
-- freeform sale_price_cents behavior on existing rows.

ALTER TABLE public.products
  ADD COLUMN discount_percent NUMERIC(5,2)
  CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100));
