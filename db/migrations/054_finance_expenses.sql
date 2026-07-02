-- Migration 054: finance_expenses — the money-OUT ledger for the Finance module.
-- Revenue is read live and read-only from public.sales (paid/fulfilled) and
-- public.bookings; this table stores only expenses, never revenue.
-- amount_cents follows the platform's integer-cents money convention
-- (mirrors sales.total_cents / bookings.price_cents) so the P&L can sum in cents.
-- created_by is ON DELETE SET NULL so removing a user_node never 23503s an expense.
-- Additive. Depends on public.clients (040-era) + public.user_nodes.

CREATE TABLE public.finance_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL,
  category     TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  note         TEXT,
  incurred_on  DATE NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_expenses_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT finance_expenses_creator_fk FOREIGN KEY (created_by) REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  CONSTRAINT finance_expenses_amount_nonneg CHECK (amount_cents >= 0),
  CONSTRAINT finance_expenses_category_not_empty CHECK (length(trim(category)) > 0),
  CONSTRAINT finance_expenses_category_valid CHECK (category IN ('rent','utilities','supplies','salaries','marketing','equipment','maintenance','other'))
);

CREATE INDEX idx_finance_expenses_client_incurred ON public.finance_expenses(client_id, incurred_on DESC);
