-- 125_product_reviews.sql — storefront reviews + Q&A with a moderation queue.
--
-- One table for both kinds. kind='review' carries a 1-5 rating; kind='question'
-- carries no rating and an optional staff `answer`. product_id is nullable so an
-- entry can be store-level (general testimonial / question) or product-scoped.
-- Everything lands status='pending' — only 'approved' rows are shown publicly.
--
-- Additive. Depends on public.clients, public.products.

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,
  rating        INTEGER,
  author_name   TEXT NOT NULL,
  author_email  TEXT,
  body          TEXT NOT NULL,
  answer        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  moderated_at  TIMESTAMPTZ,
  CONSTRAINT product_reviews_kind_chk CHECK (kind IN ('review', 'question')),
  CONSTRAINT product_reviews_status_chk CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT product_reviews_rating_chk CHECK ((kind = 'review' AND rating BETWEEN 1 AND 5) OR (kind = 'question' AND rating IS NULL))
);

CREATE INDEX IF NOT EXISTS product_reviews_queue_idx ON public.product_reviews (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS product_reviews_public_idx ON public.product_reviews (client_id, product_id, status);
