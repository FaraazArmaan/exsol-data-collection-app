-- Freeze approved payroll inputs so changing a rate or payable entry cannot rewrite closed payroll.
CREATE TABLE public.workforce_payroll_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','frozen')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_payroll_snapshots_client_period_unique UNIQUE (client_id, period_id)
)
;
CREATE TABLE public.workforce_payroll_snapshot_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.workforce_payroll_snapshots(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  deductions_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  source_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_payroll_snapshot_lines_snapshot_user_unique UNIQUE (snapshot_id, user_node_id)
)
;
CREATE INDEX workforce_payroll_snapshot_lines_client_user_idx ON public.workforce_payroll_snapshot_lines (client_id, user_node_id, created_at DESC)
;
ALTER TABLE public.payroll_periods ADD COLUMN snapshot_id UUID REFERENCES public.workforce_payroll_snapshots(id) ON DELETE SET NULL
;
CREATE UNIQUE INDEX payroll_periods_snapshot_id_unique ON public.payroll_periods (snapshot_id) WHERE snapshot_id IS NOT NULL
;
ALTER TABLE public.workforce_payroll_exports ADD COLUMN snapshot_id UUID REFERENCES public.workforce_payroll_snapshots(id) ON DELETE SET NULL
;
CREATE UNIQUE INDEX workforce_payroll_exports_snapshot_unique ON public.workforce_payroll_exports (client_id, snapshot_id) WHERE snapshot_id IS NOT NULL AND status <> 'void'
;
ALTER TABLE public.workforce_payslips ADD COLUMN snapshot_id UUID REFERENCES public.workforce_payroll_snapshots(id) ON DELETE SET NULL
;
ALTER TABLE public.workforce_payslips ADD COLUMN snapshot_line_id UUID REFERENCES public.workforce_payroll_snapshot_lines(id) ON DELETE SET NULL
;
CREATE UNIQUE INDEX workforce_payslips_snapshot_line_unique ON public.workforce_payslips (snapshot_line_id) WHERE snapshot_line_id IS NOT NULL
;
CREATE TABLE public.workforce_payroll_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES public.workforce_payroll_snapshots(id) ON DELETE RESTRICT,
  payslip_id UUID REFERENCES public.workforce_payslips(id) ON DELETE SET NULL,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','rejected')),
  resolution_note TEXT,
  submitted_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_payroll_disputes_client_period_idx ON public.workforce_payroll_disputes (client_id, period_id, status, created_at DESC)
;
CREATE TRIGGER workforce_payroll_disputes_updated_at BEFORE UPDATE ON public.workforce_payroll_disputes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
