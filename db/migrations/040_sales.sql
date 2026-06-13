-- Migration 040: sales — POS order header with FSM enums + indexes.
-- See docs/superpowers/specs/2026-06-12-pos-module-design.md.
-- bucket_id is a conceptual name from the spec; the FK target is public.clients(id).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.sale_status  AS ENUM ('pending_payment','paid','fulfilled','cancelled','refunded');
CREATE TYPE public.sale_channel AS ENUM ('instore','online','pickup');

CREATE TABLE public.sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id       UUID NOT NULL,
  order_no        INT  NOT NULL,
  status          public.sale_status  NOT NULL DEFAULT 'pending_payment',
  channel         public.sale_channel NOT NULL,

  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,

  subtotal_cents  BIGINT NOT NULL,
  discount_cents  BIGINT NOT NULL DEFAULT 0,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL,

  created_by_user_node UUID NOT NULL REFERENCES public.user_nodes(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,

  payment_method  TEXT,
  payment_ref     TEXT,

  CONSTRAINT sales_bucket_fk FOREIGN KEY (bucket_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT sales_order_no_per_bucket UNIQUE (bucket_id, order_no),
  CONSTRAINT sales_phone_not_empty CHECK (length(trim(customer_phone)) > 0),
  CONSTRAINT sales_name_not_empty  CHECK (length(trim(customer_name))  > 0),
  CONSTRAINT sales_total_matches   CHECK (total_cents = subtotal_cents - discount_cents + tax_cents)
);

CREATE INDEX idx_sales_bucket_created   ON public.sales(bucket_id, created_at DESC);
CREATE INDEX idx_sales_bucket_status    ON public.sales(bucket_id, status);
CREATE INDEX idx_sales_bucket_channel   ON public.sales(bucket_id, channel);
CREATE INDEX idx_sales_bucket_creator   ON public.sales(bucket_id, created_by_user_node, created_at DESC);
CREATE INDEX idx_sales_phone_trgm       ON public.sales USING gin (customer_phone gin_trgm_ops);
