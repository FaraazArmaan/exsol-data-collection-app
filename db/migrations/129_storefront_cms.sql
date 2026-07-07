-- 129_storefront_cms.sql — editable storefront content (hero + banners).
--
-- Mirrors brand_site_config (062): one row per client, sections JSONB holds the
-- editable blocks, published gates whether the public /menu/:slug renders them.
-- Kept separate from brand_site_config because the storefront (POS menu) and the
-- brand portfolio site are distinct surfaces with distinct copy.
--
-- Additive + idempotent. Depends on public.clients, public.set_updated_at (005).

CREATE TABLE IF NOT EXISTS public.storefront_cms (
  client_id  UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  sections   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  published  BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER storefront_cms_set_updated_at BEFORE UPDATE ON public.storefront_cms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
