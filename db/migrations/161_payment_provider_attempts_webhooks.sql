-- Provider attempts and the durable webhook inbox for verified online collection.
CREATE TABLE public.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('razorpay')),
  status TEXT NOT NULL CHECK (status IN ('created', 'captured', 'failed', 'expired', 'quarantined')),
  provider_order_id TEXT NOT NULL,
  provider_payment_id TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  expires_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id),
  UNIQUE (provider, provider_payment_id)
)
;
CREATE INDEX payment_attempts_request_idx ON public.payment_attempts (request_id, created_at DESC)
;
CREATE TRIGGER payment_attempts_updated_at BEFORE UPDATE ON public.payment_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('razorpay')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'ignored', 'quarantined')),
  reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, provider_event_id)
)
;
CREATE INDEX payment_webhook_events_attempt_idx ON public.payment_webhook_events (attempt_id, received_at DESC)
;
