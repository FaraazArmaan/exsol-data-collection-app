-- Employee master profile records for Workforce M5.
CREATE TABLE public.workforce_employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  employee_number TEXT,
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  preferred_name TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','terminated')),
  employment_type TEXT NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time','contractor','intern')),
  job_title TEXT,
  department TEXT,
  hire_date DATE,
  termination_date DATE,
  manager_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  primary_email TEXT,
  primary_phone TEXT,
  emergency_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_employee_profiles_resource_unique UNIQUE (client_id, resource_id),
  CONSTRAINT workforce_employee_profiles_number_unique UNIQUE (client_id, employee_number),
  CONSTRAINT workforce_employee_profiles_termination_after_hire CHECK (termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date)
)
;
CREATE INDEX workforce_employee_profiles_client_status_idx ON public.workforce_employee_profiles (client_id, employment_status, legal_name)
;
CREATE TRIGGER workforce_employee_profiles_updated_at BEFORE UPDATE ON public.workforce_employee_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
