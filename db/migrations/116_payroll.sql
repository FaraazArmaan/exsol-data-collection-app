-- Payroll rates per user_node and payroll period tracking (mig 116).
-- TRACKING ONLY — no payment execution.
-- Rates: one row per (client, user_node, effective_from). Latest rate before period_start is used.
CREATE TABLE public.payroll_rates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id    UUID        NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  hourly_rate     NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
  effective_from  DATE        NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_rates_user_date_unique UNIQUE (client_id, user_node_id, effective_from)
)
;
-- Payroll periods: draft → approved. total_amount is computed and stored on approval.
CREATE TABLE public.payroll_periods (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_start    DATE        NOT NULL,
  period_end      DATE        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  total_amount    NUMERIC(12,2),
  created_by      UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  approved_by     UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_periods_date_order CHECK (period_end >= period_start),
  CONSTRAINT payroll_periods_unique UNIQUE (client_id, period_start, period_end)
)
;
