-- 065: expense approvals.
-- finance_settings.approval_threshold_cents (in the client base currency) is the
-- bar: a manually-entered expense whose base amount is >= threshold is created
-- 'pending' and must be approved/rejected before it counts toward the P&L.
-- approval_status NULL = below threshold (auto-counted). Only NULL + 'approved'
-- expenses are summed in the P&L / cashflow. Cron-materialized expenses skip the
-- gate (the recurring template IS the authorization). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.finance_settings (
  client_id                UUID PRIMARY KEY,
  approval_threshold_cents BIGINT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_settings_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT finance_settings_threshold_nonneg CHECK (approval_threshold_cents >= 0)
);

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS approval_status TEXT;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS approved_by UUID;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_approval_status_valid;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_approval_status_valid CHECK (approval_status IS NULL OR approval_status IN ('pending','approved','rejected'));

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_approved_by_fk;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_approved_by_fk FOREIGN KEY (approved_by) REFERENCES public.user_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_expenses_pending ON public.finance_expenses(client_id) WHERE approval_status = 'pending';
