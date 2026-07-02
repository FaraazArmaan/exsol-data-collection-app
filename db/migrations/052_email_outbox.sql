-- 052_email_outbox.sql — auditable transactional-email outbox.
-- One row per send attempt (booking confirmation, storefront receipt). The
-- rendered HTML + payload are stored so the outbox is auditable and the vendor
-- UI can preview exactly what was sent, without re-rendering.
-- status: pending (row written pre-send) -> sent | failed | logged (dev/no-key).
-- Additive + idempotent. Depends on public.clients.

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_email      TEXT        NOT NULL,
  template      TEXT        NOT NULL,
  subject       TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  body_html     TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  provider_id   TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  CONSTRAINT email_outbox_status_chk CHECK (status IN ('pending','sent','failed','logged')),
  CONSTRAINT email_outbox_template_chk CHECK (template IN ('booking_confirmation','storefront_receipt'))
);

CREATE INDEX IF NOT EXISTS email_outbox_client_created_idx ON public.email_outbox (client_id, created_at DESC);
