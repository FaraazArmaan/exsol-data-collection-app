-- Payroll export batches and payslip records for Workforce M9.
CREATE TABLE public.workforce_payroll_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  export_format TEXT NOT NULL DEFAULT 'csv' CHECK (export_format IN ('csv','json','provider')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','sent','void')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  exported_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  exported_at TIMESTAMPTZ,
  file_id UUID REFERENCES public.files(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_payroll_exports_client_period_idx ON public.workforce_payroll_exports (client_id, period_id, created_at DESC)
;
CREATE TRIGGER workforce_payroll_exports_updated_at BEFORE UPDATE ON public.workforce_payroll_exports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  export_id UUID REFERENCES public.workforce_payroll_exports(id) ON DELETE SET NULL,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  deductions_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','void')),
  published_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_payslips_period_user_unique UNIQUE (client_id, period_id, user_node_id)
)
;
CREATE INDEX workforce_payslips_client_period_idx ON public.workforce_payslips (client_id, period_id, status)
;
CREATE INDEX workforce_payslips_user_node_idx ON public.workforce_payslips (client_id, user_node_id, created_at DESC)
;
CREATE TRIGGER workforce_payslips_updated_at BEFORE UPDATE ON public.workforce_payslips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
