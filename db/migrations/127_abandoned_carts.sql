-- 127_abandoned_carts.sql — persisted guest carts for abandoned-cart reminders.
--
-- The storefront guest cart normally lives only in the browser's sessionStorage.
-- Once a guest supplies an email at checkout we upsert a snapshot here (keyed by
-- the per-tab session id). A cron sweep emails 'active' carts that went cold; a
-- completed sale flips the matching cart to 'converted' so it's never nudged.
--
-- Additive. Depends on public.clients, public.set_updated_at (005).

CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_key    TEXT NOT NULL,
  customer_name  TEXT,
  customer_email TEXT NOT NULL,
  channel        TEXT,
  lines          JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  reminded_at    TIMESTAMPTZ,
  converted_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT abandoned_carts_status_chk CHECK (status IN ('active', 'reminded', 'converted')),
  CONSTRAINT abandoned_carts_subtotal_chk CHECK (subtotal_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_session_uniq ON public.abandoned_carts (client_id, session_key);

CREATE INDEX IF NOT EXISTS abandoned_carts_sweep_idx ON public.abandoned_carts (status, updated_at);

CREATE TRIGGER abandoned_carts_set_updated_at BEFORE UPDATE ON public.abandoned_carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
