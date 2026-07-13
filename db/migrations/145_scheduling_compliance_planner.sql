-- Scheduling compliance planner rules and findings for Workforce M6.
CREATE TABLE public.workforce_compliance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  max_daily_hours NUMERIC(4,2) CHECK (max_daily_hours IS NULL OR max_daily_hours > 0),
  max_weekly_hours NUMERIC(5,2) CHECK (max_weekly_hours IS NULL OR max_weekly_hours > 0),
  break_required_after_hours NUMERIC(4,2) CHECK (break_required_after_hours IS NULL OR break_required_after_hours > 0),
  min_break_minutes INTEGER CHECK (min_break_minutes IS NULL OR min_break_minutes > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_compliance_rules_date_order CHECK (effective_to IS NULL OR effective_to >= effective_from)
)
;
CREATE INDEX workforce_compliance_rules_client_active_idx ON public.workforce_compliance_rules (client_id, active, effective_from DESC)
;
CREATE TRIGGER workforce_compliance_rules_updated_at BEFORE UPDATE ON public.workforce_compliance_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_schedule_compliance_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.workforce_shifts(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.workforce_compliance_rules(id) ON DELETE SET NULL,
  schedule_date DATE NOT NULL,
  finding_type TEXT NOT NULL CHECK (finding_type IN ('max_daily_hours','max_weekly_hours','missing_break','overlap','outside_availability')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','blocker')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waived','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_schedule_findings_client_date_idx ON public.workforce_schedule_compliance_findings (client_id, schedule_date DESC, status)
;
CREATE INDEX workforce_schedule_findings_resource_idx ON public.workforce_schedule_compliance_findings (client_id, resource_id, schedule_date DESC)
;
CREATE TRIGGER workforce_schedule_compliance_findings_updated_at BEFORE UPDATE ON public.workforce_schedule_compliance_findings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
