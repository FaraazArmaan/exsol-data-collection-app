-- Tenant-owned provider credentials. API and webhook secrets are AES-256-GCM ciphertexts.
CREATE TABLE public.payment_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('razorpay')),
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  key_id TEXT,
  api_secret_enc TEXT,
  webhook_secret_enc TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider, mode),
  CHECK (NOT enabled OR (key_id IS NOT NULL AND api_secret_enc IS NOT NULL AND webhook_secret_enc IS NOT NULL))
)
;
CREATE INDEX payment_provider_connections_client_idx ON public.payment_provider_connections (client_id)
;
CREATE TRIGGER payment_provider_connections_updated_at BEFORE UPDATE ON public.payment_provider_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
