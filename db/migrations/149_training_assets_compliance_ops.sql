-- Training and asset compliance operations for Workforce M10.
CREATE TABLE public.workforce_compliance_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('training','asset')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  course_id UUID REFERENCES public.training_courses(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES public.workforce_assets(id) ON DELETE SET NULL,
  required_for_employment_type TEXT CHECK (required_for_employment_type IS NULL OR required_for_employment_type IN ('full_time','part_time','contractor','intern')),
  due_within_days INTEGER CHECK (due_within_days IS NULL OR due_within_days >= 0),
  recurrence_days INTEGER CHECK (recurrence_days IS NULL OR recurrence_days > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_compliance_requirements_client_idx ON public.workforce_compliance_requirements (client_id, requirement_type, active)
;
CREATE TRIGGER workforce_compliance_requirements_updated_at BEFORE UPDATE ON public.workforce_compliance_requirements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_asset_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.workforce_assets(id) ON DELETE CASCADE,
  scheduled_for DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','overdue')),
  notes TEXT,
  performed_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_asset_maintenance_asset_idx ON public.workforce_asset_maintenance (client_id, asset_id, scheduled_for DESC)
;
CREATE TRIGGER workforce_asset_maintenance_updated_at BEFORE UPDATE ON public.workforce_asset_maintenance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_compliance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES public.workforce_compliance_requirements(id) ON DELETE SET NULL,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','waived','overdue')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  source_type TEXT CHECK (source_type IS NULL OR source_type IN ('training_completion','asset_assignment','asset_maintenance','manual')),
  source_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_compliance_tasks_client_status_idx ON public.workforce_compliance_tasks (client_id, status, due_date)
;
CREATE INDEX workforce_compliance_tasks_resource_idx ON public.workforce_compliance_tasks (client_id, resource_id, status)
;
CREATE TRIGGER workforce_compliance_tasks_updated_at BEFORE UPDATE ON public.workforce_compliance_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
