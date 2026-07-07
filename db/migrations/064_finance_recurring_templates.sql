-- 064: recurring + milestone expense templates.
-- A template auto-materializes into finance_expenses when next_run is due, via a
-- scheduled function (or an on-demand run). cadence 'once' = a milestone (fires
-- once, then deactivates); 'weekly'/'monthly' repeat and advance next_run.
-- amount_cents/currency/fx_rate mirror the expense multicurrency shape (063).
-- finance_expenses gains template_id so materialized rows are traceable + badged.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.finance_recurring_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL,
  category             TEXT NOT NULL,
  amount_cents         BIGINT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'INR',
  fx_rate              NUMERIC(18,6) NOT NULL DEFAULT 1,
  note                 TEXT,
  cadence              TEXT NOT NULL,
  next_run             DATE NOT NULL,
  active               BOOLEAN NOT NULL DEFAULT true,
  last_materialized_on DATE,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_rt_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT finance_rt_creator_fk FOREIGN KEY (created_by) REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  CONSTRAINT finance_rt_amount_nonneg CHECK (amount_cents >= 0),
  CONSTRAINT finance_rt_fx_pos CHECK (fx_rate > 0),
  CONSTRAINT finance_rt_category_valid CHECK (category IN ('rent','utilities','supplies','salaries','marketing','equipment','maintenance','other')),
  CONSTRAINT finance_rt_cadence_valid CHECK (cadence IN ('once','weekly','monthly'))
);

CREATE INDEX IF NOT EXISTS idx_finance_rt_client ON public.finance_recurring_templates(client_id, active);

CREATE INDEX IF NOT EXISTS idx_finance_rt_due ON public.finance_recurring_templates(next_run) WHERE active;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS template_id UUID;

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_template_fk;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_template_fk FOREIGN KEY (template_id) REFERENCES public.finance_recurring_templates(id) ON DELETE SET NULL;
