-- 044_bookings.sql — the booking row + atomic no-overbook guarantee.
-- A single INSERT is atomic against the EXCLUDE constraint, so concurrent
-- bookings for the same resource+time resolve to exactly one winner (others
-- raise 23P01). This is why we don't need multi-statement transactions.
--
-- ⚠️ NUMBERING: tentatively 044 (depends on 043). See coordination note in 043.

CREATE TYPE public.booking_status AS ENUM
  ('pending','confirmed','blocked','completed','cancelled','no_show');

CREATE TABLE public.bookings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id            UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_id           UUID        REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  resource_id          UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE RESTRICT,
  user_node_id         UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  time_range           TSTZRANGE   NOT NULL,
  status               public.booking_status NOT NULL DEFAULT 'pending',
  customer_name        TEXT,
  customer_phone       TEXT,
  customer_email       TEXT,
  price_cents          BIGINT      NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  deposit_paid_cents   BIGINT      NOT NULL DEFAULT 0 CHECK (deposit_paid_cents >= 0),
  cancellation_reason  TEXT,
  cancelled_at         TIMESTAMPTZ,
  manage_token         TEXT        UNIQUE,
  created_by_user_node UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- blocked staff-time has no customer/service; every other status requires both.
  CHECK (
    (status = 'blocked' AND service_id IS NULL AND user_node_id IS NULL)
    OR (status <> 'blocked' AND service_id IS NOT NULL AND user_node_id IS NOT NULL)
  ),
  -- one resource cannot hold two live bookings whose ranges overlap.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    time_range  WITH &&
  ) WHERE (status IN ('pending','confirmed','blocked'))
);

CREATE INDEX bookings_bucket_range_idx ON public.bookings USING gist (bucket_id, time_range);
CREATE INDEX bookings_bucket_status_idx ON public.bookings (bucket_id, status);
CREATE INDEX bookings_resource_idx ON public.bookings (resource_id, status);
CREATE INDEX bookings_user_node_idx ON public.bookings (user_node_id);
