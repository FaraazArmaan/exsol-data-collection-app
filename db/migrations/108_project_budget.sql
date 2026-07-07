-- Project Budget Tracker (mig 108): add budget and hourly rate to projects;
-- add optional project_id FK to finance_expenses for expense attribution.
ALTER TABLE public.projects
  ADD COLUMN budget_cents BIGINT,
  ADD COLUMN hourly_rate_cents BIGINT
;
ALTER TABLE public.finance_expenses
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL
;
CREATE INDEX IF NOT EXISTS finance_expenses_project_idx
  ON public.finance_expenses (project_id)
  WHERE project_id IS NOT NULL
;
