-- Visits group one customer booking and its sequential service lines.
CREATE TABLE public.booking_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  time_range TSTZRANGE NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  price_cents BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  deposit_paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (deposit_paid_cents >= 0),
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  manage_token TEXT UNIQUE,
  created_by_user_node UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (upper(time_range) > lower(time_range))
)
;
CREATE INDEX booking_visits_bucket_range_idx ON public.booking_visits USING gist (bucket_id, time_range)
;
CREATE INDEX booking_visits_bucket_status_idx ON public.booking_visits (bucket_id, status)
;

-- Each line snapshots the service commercial terms used for the visit.
CREATE TABLE public.booking_appointment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.booking_visits(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE RESTRICT,
  time_range TSTZRANGE NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  buffer_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (visit_id, sequence_number),
  CHECK (upper(time_range) > lower(time_range))
)
;
CREATE INDEX booking_appointment_lines_visit_sequence_idx ON public.booking_appointment_lines (visit_id, sequence_number)
;

-- Reservations are the capacity-level exclusion guard for every appointment line.
CREATE TABLE public.booking_line_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.booking_visits(id) ON DELETE CASCADE,
  appointment_line_id UUID NOT NULL REFERENCES public.booking_appointment_lines(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE RESTRICT,
  time_range TSTZRANGE NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (appointment_line_id, resource_id),
  CHECK (upper(time_range) > lower(time_range)),
  CONSTRAINT booking_line_reservations_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    time_range WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'blocked'))
)
;
CREATE INDEX booking_line_reservations_visit_idx ON public.booking_line_reservations (visit_id, status)
;

-- Legacy bookings remain the primary-line compatibility projection during the transition.
ALTER TABLE public.bookings ADD COLUMN visit_id UUID REFERENCES public.booking_visits(id) ON DELETE CASCADE
;
ALTER TABLE public.bookings ADD COLUMN appointment_line_id UUID REFERENCES public.booking_appointment_lines(id) ON DELETE SET NULL
;
CREATE INDEX bookings_visit_idx ON public.bookings (visit_id)
;

-- Backfill every existing one-service booking into a visit and one appointment line.
INSERT INTO public.booking_visits (
  id, bucket_id, user_node_id, time_range, status, customer_name, customer_phone,
  customer_email, price_cents, deposit_paid_cents, cancellation_reason, cancelled_at,
  manage_token, created_by_user_node, created_at, updated_at
)
SELECT
  b.id, b.bucket_id, b.user_node_id, b.time_range, b.status, b.customer_name, b.customer_phone,
  b.customer_email, b.price_cents, b.deposit_paid_cents, b.cancellation_reason, b.cancelled_at,
  b.manage_token, b.created_by_user_node, b.created_at, b.updated_at
FROM public.bookings b
ON CONFLICT (id) DO NOTHING
;
UPDATE public.bookings SET visit_id = id WHERE visit_id IS NULL
;
INSERT INTO public.booking_appointment_lines (
  visit_id, service_id, sequence_number, resource_id, time_range, duration_min, buffer_min, price_cents, created_at
)
SELECT
  b.visit_id, b.service_id, 1, b.resource_id, b.time_range,
  COALESCE(s.duration_min, GREATEST(1, EXTRACT(EPOCH FROM (upper(b.time_range) - lower(b.time_range)))::INTEGER / 60)),
  COALESCE(s.buffer_min, 0), b.price_cents, b.created_at
FROM public.bookings b
LEFT JOIN public.booking_services s ON s.id = b.service_id
WHERE b.service_id IS NOT NULL
;
UPDATE public.bookings b
SET appointment_line_id = l.id
FROM public.booking_appointment_lines l
WHERE l.visit_id = b.visit_id AND l.sequence_number = 1 AND b.appointment_line_id IS NULL
;
INSERT INTO public.booking_line_reservations (visit_id, appointment_line_id, resource_id, time_range, status, created_at)
SELECT b.visit_id, b.appointment_line_id, b.resource_id, b.time_range, b.status, b.created_at
FROM public.bookings b
WHERE b.appointment_line_id IS NOT NULL
ON CONFLICT (appointment_line_id, resource_id) DO NOTHING
;
