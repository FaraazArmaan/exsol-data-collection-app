-- Time clock append-only event ledger and correction workflow for Workforce M7.
CREATE TABLE public.workforce_time_clock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  punch_id UUID REFERENCES public.workforce_punches(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in','clock_out','correction','absence','note')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','kiosk','mobile','system','import')),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_time_clock_events_client_resource_idx ON public.workforce_time_clock_events (client_id, resource_id, occurred_at DESC)
;
CREATE INDEX workforce_time_clock_events_punch_idx ON public.workforce_time_clock_events (client_id, punch_id, occurred_at DESC)
;
CREATE TABLE public.workforce_time_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  punch_id UUID REFERENCES public.workforce_punches(id) ON DELETE SET NULL,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  correction_type TEXT NOT NULL CHECK (correction_type IN ('missed_clock_in','missed_clock_out','edit_time','delete_punch')),
  original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_time_corrections_client_status_idx ON public.workforce_time_corrections (client_id, status, created_at DESC)
;
CREATE INDEX workforce_time_corrections_resource_idx ON public.workforce_time_corrections (client_id, resource_id, created_at DESC)
;
CREATE TRIGGER workforce_time_corrections_updated_at BEFORE UPDATE ON public.workforce_time_corrections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
