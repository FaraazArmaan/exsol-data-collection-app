-- 062_brand_site_config.sql — per-client Brand Portfolio Site configuration.
-- One row per client. sections JSONB holds per-section enable flags (+ copy);
-- published gates the public /site/:slug page. Additive + idempotent.
-- Depends on public.clients.

CREATE TABLE IF NOT EXISTS public.brand_site_config (
  client_id   UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  sections    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  published   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
