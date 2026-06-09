-- Migration 037: extended product fields for platform exports.
-- See docs/superpowers/specs/2026-06-09-platform-exports-design.md §Schema.
-- Additive; safe to run before code deploy.

ALTER TABLE public.products ADD COLUMN gtin              TEXT;
ALTER TABLE public.products ADD COLUMN mpn               TEXT;
ALTER TABLE public.products ADD COLUMN condition         TEXT NOT NULL DEFAULT 'new'
  CHECK (condition IN ('new','refurbished','used'));
ALTER TABLE public.products ADD COLUMN availability      TEXT NOT NULL DEFAULT 'in_stock'
  CHECK (availability IN ('in_stock','out_of_stock','preorder','discontinued'));
ALTER TABLE public.products ADD COLUMN sale_price_cents  INT
  CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0);
ALTER TABLE public.products ADD COLUMN sale_starts_at    TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN sale_ends_at      TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN weight_grams      INT
  CHECK (weight_grams IS NULL OR weight_grams >= 0);
ALTER TABLE public.products ADD COLUMN length_mm         INT;
ALTER TABLE public.products ADD COLUMN width_mm          INT;
ALTER TABLE public.products ADD COLUMN height_mm         INT;
ALTER TABLE public.products ADD COLUMN color             TEXT;
ALTER TABLE public.products ADD COLUMN size              TEXT;
ALTER TABLE public.products ADD COLUMN material          TEXT;
ALTER TABLE public.products ADD COLUMN gender            TEXT;
ALTER TABLE public.products ADD COLUMN age_group         TEXT;
ALTER TABLE public.products ADD COLUMN manufacturer      TEXT;
ALTER TABLE public.products ADD COLUMN country_of_origin TEXT;
ALTER TABLE public.products ADD COLUMN hsn_code          TEXT;
ALTER TABLE public.products ADD COLUMN gst_rate          NUMERIC(5,2);
ALTER TABLE public.products ADD COLUMN google_category   TEXT;
ALTER TABLE public.products ADD COLUMN meta_category     TEXT;
ALTER TABLE public.products ADD COLUMN product_url       TEXT;
ALTER TABLE public.products ADD COLUMN platform_extras   JSONB NOT NULL DEFAULT '{}'::jsonb;
