CREATE TABLE public.client_enabled_products (
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_key      TEXT NOT NULL,
  enabled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by_admin UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  PRIMARY KEY (client_id, product_key)
);
CREATE INDEX client_enabled_products_client_idx ON public.client_enabled_products (client_id);
-- Tracks which Product manifests are enabled for a given Client.
-- Product manifests themselves live in code; this table is just the join.
