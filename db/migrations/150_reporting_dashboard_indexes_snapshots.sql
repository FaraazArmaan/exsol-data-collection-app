-- Reporting dashboard snapshots and supporting indexes for Workforce M11.
CREATE TABLE public.workforce_dashboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_dashboard_snapshots_unique UNIQUE (client_id, snapshot_date)
)
;
CREATE INDEX workforce_dashboard_snapshots_client_date_idx ON public.workforce_dashboard_snapshots (client_id, snapshot_date DESC)
;
CREATE INDEX workforce_employee_profiles_user_node_idx ON public.workforce_employee_profiles (client_id, user_node_id)
;
CREATE INDEX workforce_schedule_findings_type_idx ON public.workforce_schedule_compliance_findings (client_id, finding_type, status)
;
CREATE INDEX workforce_time_corrections_punch_idx ON public.workforce_time_corrections (client_id, punch_id)
;
CREATE INDEX workforce_leave_ledger_type_date_idx ON public.workforce_leave_ledger (client_id, leave_type, entry_date DESC)
;
CREATE INDEX workforce_payroll_exports_status_idx ON public.workforce_payroll_exports (client_id, status, created_at DESC)
;
CREATE INDEX workforce_compliance_tasks_due_idx ON public.workforce_compliance_tasks (client_id, due_date, status)
;
