-- 063: multicurrency support for finance_expenses.
-- amount_cents stays the ENTRY-currency minor units; `currency` names it.
-- amount_base_cents is that value converted to the client's base currency
-- (clients.base_currency) via fx_rate = base major units per 1 entry major unit.
-- The P&L + cashflow aggregate on amount_base_cents so mixed-currency ledgers sum.
-- Backfill: existing rows were entered in INR (the platform default base) →
-- currency stays 'INR', fx_rate 1, amount_base_cents = amount_cents.
-- Additive + idempotent. No cross-table dependency (keeps migrate ordering safe).

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS amount_base_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) NOT NULL DEFAULT 1;

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_fx_rate_pos;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_fx_rate_pos CHECK (fx_rate > 0);

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_base_nonneg;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_base_nonneg CHECK (amount_base_cents >= 0);

UPDATE public.finance_expenses
  SET amount_base_cents = amount_cents
  WHERE amount_base_cents = 0;
