-- Payment state is independent from whether the customer is expected for the visit.
CREATE TYPE public.booking_payment_status AS ENUM (
  'unpaid', 'payment_requested', 'partly_paid', 'paid', 'refunded', 'waived', 'cash_pending'
)
;

ALTER TABLE public.booking_visits
  ADD COLUMN payment_status public.booking_payment_status NOT NULL DEFAULT 'unpaid'
;
UPDATE public.booking_visits
SET payment_status = CASE
  WHEN price_cents = 0 THEN 'waived'::public.booking_payment_status
  WHEN deposit_paid_cents >= price_cents THEN 'paid'::public.booking_payment_status
  WHEN deposit_paid_cents > 0 THEN 'partly_paid'::public.booking_payment_status
  WHEN status = 'pending' THEN 'payment_requested'::public.booking_payment_status
  ELSE 'cash_pending'::public.booking_payment_status
END
;

-- Events are immutable evidence of booking and offline-payment changes.
CREATE TABLE public.booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.booking_visits(id) ON DELETE CASCADE,
  bucket_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_user_node UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('public', 'customer', 'vendor', 'system', 'payment')),
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX booking_events_visit_created_idx ON public.booking_events (visit_id, created_at)
;
CREATE INDEX booking_events_bucket_created_idx ON public.booking_events (bucket_id, created_at)
;

-- Existing visits gain a migration event rather than fabricated historical events.
INSERT INTO public.booking_events (
  visit_id, bucket_id, source, event_type, new_state, created_at
)
SELECT
  v.id,
  v.bucket_id,
  'system',
  'visit_history_started',
  jsonb_build_object('appointment_status', v.status, 'payment_status', v.payment_status),
  now()
FROM public.booking_visits v
;

CREATE FUNCTION public.booking_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS 'BEGIN RAISE EXCEPTION ''booking_events are append-only''; END;'
;
CREATE TRIGGER booking_events_no_mutation
BEFORE UPDATE OR DELETE ON public.booking_events
FOR EACH ROW EXECUTE FUNCTION public.booking_events_append_only()
;
