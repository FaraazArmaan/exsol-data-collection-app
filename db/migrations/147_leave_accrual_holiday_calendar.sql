-- Leave accrual policies, holiday calendar, and leave ledger for Workforce M8.
CREATE TABLE public.workforce_leave_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','personal','unpaid')),
  accrual_rate_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (accrual_rate_days >= 0),
  accrual_period TEXT NOT NULL DEFAULT 'monthly' CHECK (accrual_period IN ('monthly','biweekly','annual','manual')),
  carryover_cap_days NUMERIC(6,2) CHECK (carryover_cap_days IS NULL OR carryover_cap_days >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_leave_policies_date_order CHECK (effective_to IS NULL OR effective_to >= effective_from)
)
;
CREATE INDEX workforce_leave_policies_client_type_idx ON public.workforce_leave_policies (client_id, leave_type, active, effective_from DESC)
;
CREATE TRIGGER workforce_leave_policies_updated_at BEFORE UPDATE ON public.workforce_leave_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  holiday_date DATE NOT NULL,
  region TEXT,
  paid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_holidays_unique UNIQUE (client_id, holiday_date, name)
)
;
CREATE INDEX workforce_holidays_client_date_idx ON public.workforce_holidays (client_id, holiday_date)
;
CREATE TABLE public.workforce_leave_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','personal','unpaid')),
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('accrual','usage','adjustment','carryover','expiry')),
  days_delta NUMERIC(6,2) NOT NULL,
  request_id UUID REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_leave_ledger_resource_idx ON public.workforce_leave_ledger (client_id, resource_id, leave_type, entry_date DESC)
;
