CREATE TABLE public.orders_return_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  issued_by uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_return_access_tokens_expiry_check CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX orders_return_access_tokens_one_active_sale_idx ON public.orders_return_access_tokens (sale_id) WHERE revoked_at IS NULL;
CREATE INDEX orders_return_access_tokens_lookup_idx ON public.orders_return_access_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX orders_return_access_tokens_client_sale_idx ON public.orders_return_access_tokens (client_id, sale_id, created_at DESC);
