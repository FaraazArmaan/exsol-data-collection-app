-- 124_coupons.sql — storefront discount coupons + redemption ledger.
--
-- coupons: per-client promo codes. discount_type is 'percent' (value 1-100) or
-- 'fixed' (value = minor units off). Optional min order, global cap, per-customer
-- cap, and a start/expiry window. redeemed_count is bumped atomically at
-- storefront checkout under a conditional UPDATE so the global cap is race-safe.
--
-- coupon_redemptions: one row per applied coupon (FK to the sale). customer_key
-- is the normalized phone/email used to enforce per_customer_limit.
--
-- Additive. Depends on public.clients, public.sales, public.set_updated_at (005).

CREATE TABLE IF NOT EXISTS public.coupons (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  discount_type      TEXT NOT NULL,
  discount_value     INTEGER NOT NULL,
  min_order_cents    INTEGER NOT NULL DEFAULT 0,
  max_redemptions    INTEGER,
  per_customer_limit INTEGER,
  redeemed_count     INTEGER NOT NULL DEFAULT 0,
  starts_at          TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_discount_chk CHECK ((discount_type = 'percent' AND discount_value BETWEEN 1 AND 100) OR (discount_type = 'fixed' AND discount_value > 0)),
  CONSTRAINT coupons_min_order_chk CHECK (min_order_cents >= 0),
  CONSTRAINT coupons_max_redemptions_chk CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  CONSTRAINT coupons_per_customer_chk CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  CONSTRAINT coupons_redeemed_chk CHECK (redeemed_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_client_code_uniq ON public.coupons (client_id, lower(code));

CREATE INDEX IF NOT EXISTS coupons_client_active_idx ON public.coupons (client_id, active);

CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id      UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  sale_id        UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  customer_key   TEXT,
  discount_cents INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id);

CREATE INDEX IF NOT EXISTS coupon_redemptions_customer_idx ON public.coupon_redemptions (coupon_id, customer_key);
