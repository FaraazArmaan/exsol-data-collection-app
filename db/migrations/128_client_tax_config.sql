-- 128_client_tax_config.sql — per-client storefront tax/VAT settings.
--
-- One row per client. rate_bps is basis points (1800 = 18%). inclusive = prices
-- already contain tax (extract for display, total unchanged) vs exclusive (add
-- on top, shown as a line). Applied to (subtotal − discount) at checkout to fill
-- sales.tax_cents. Additive. Depends on public.clients, public.set_updated_at.

CREATE TABLE IF NOT EXISTS public.client_tax_config (
  client_id  UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  rate_bps   INTEGER NOT NULL DEFAULT 0,
  label      TEXT NOT NULL DEFAULT 'Tax',
  inclusive  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_tax_config_rate_chk CHECK (rate_bps BETWEEN 0 AND 10000)
);

CREATE TRIGGER client_tax_config_set_updated_at BEFORE UPDATE ON public.client_tax_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
