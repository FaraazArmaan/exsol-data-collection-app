-- 043_booking_core.sql — Booking module foundation (see specs/2026-06-29-booking-module-design.md §2).
-- Tenant timezone + vendor configuration tables. The bookings table + gist
-- constraint land in 044. No slots table — availability is computed on-read.
--
-- NUMBERING: 043–045 confirmed owned by Booking (2026-06-30). POS-v2 is zero-migration;
--    its storefront spec's 043/044/045 are spec-only and will take the next free block
--    after Booking when built. Safe to apply.

-- btree_gist: required for EXCLUDE on (resource_id uuid =, time_range tstzrange &&)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Tenant-local timezone. All grid math runs in this zone; instants stored UTC.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- One settings row per tenant.
CREATE TABLE public.booking_settings (
  bucket_id          UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  slot_interval_min  INTEGER     NOT NULL DEFAULT 15  CHECK (slot_interval_min BETWEEN 5 AND 240),
  lead_time_min      INTEGER     NOT NULL DEFAULT 0   CHECK (lead_time_min >= 0),
  cancel_cutoff_min  INTEGER     NOT NULL DEFAULT 0   CHECK (cancel_cutoff_min >= 0),
  weekly_schedule    JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- { "mon": [{"open":"09:00","close":"18:00"}], ... }
  date_overrides     JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [ {"date":"2026-08-15","closed":true} ]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named staff / rooms.
CREATE TABLE public.booking_resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  weekly_schedule  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- same shape as settings; {} = inherit tenant hours
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_resources_bucket_active_idx
  ON public.booking_resources (bucket_id, active);

-- Per-resource one-off blocks (vacation, half-day).
CREATE TABLE public.booking_resource_time_off (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX booking_time_off_resource_idx
  ON public.booking_resource_time_off (resource_id, starts_at);

-- Per-service payment behavior.
CREATE TYPE public.booking_payment_mode AS ENUM ('pay_at_venue','deposit','full_upfront');

-- Vendor service catalog.
CREATE TABLE public.booking_services (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id             UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  duration_min          INTEGER     NOT NULL CHECK (duration_min > 0),
  price_cents           BIGINT      NOT NULL CHECK (price_cents >= 0),
  payment_mode          public.booking_payment_mode NOT NULL DEFAULT 'pay_at_venue',
  deposit_cents         BIGINT      CHECK (deposit_cents IS NULL OR deposit_cents >= 0),
  buffer_min            INTEGER     NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  active                BOOLEAN     NOT NULL DEFAULT true,
  eligible_resource_ids UUID[]      NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- deposit mode must name a deposit amount
  CHECK (payment_mode <> 'deposit' OR deposit_cents IS NOT NULL)
);
CREATE INDEX booking_services_bucket_active_idx
  ON public.booking_services (bucket_id, active);
