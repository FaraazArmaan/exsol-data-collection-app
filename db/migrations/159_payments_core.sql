-- Shared, immutable payment evidence for Booking first and POS/storefront next.
CREATE TABLE public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('booking_visit', 'sale')),
  source_id UUID NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('deposit', 'full_upfront', 'balance', 'sale_total')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partly_paid', 'paid', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, source_type, source_id, purpose)
)
;
CREATE INDEX payment_requests_client_status_idx ON public.payment_requests (client_id, status, created_at DESC)
;
CREATE TABLE public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cash_received', 'provider_captured', 'provider_failed', 'provider_refunded', 'adjustment')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'void')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  provider TEXT,
  provider_transaction_id TEXT,
  reference TEXT,
  actor_user_node UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE UNIQUE INDEX payment_transactions_provider_reference_key ON public.payment_transactions (provider, provider_transaction_id) WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL
;
CREATE INDEX payment_transactions_client_created_idx ON public.payment_transactions (client_id, created_at DESC)
;
CREATE TABLE public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, request_id)
)
;
CREATE INDEX payment_allocations_request_idx ON public.payment_allocations (request_id)
;
CREATE TRIGGER payment_requests_updated_at BEFORE UPDATE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
