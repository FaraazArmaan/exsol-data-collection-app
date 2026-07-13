-- Workforce self-service time clock geofences and break tracking.
CREATE TABLE public.workforce_work_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  radius_meters INTEGER NOT NULL DEFAULT 100 CHECK (radius_meters > 0 AND radius_meters <= 5000),
  min_accuracy_meters INTEGER NOT NULL DEFAULT 150 CHECK (min_accuracy_meters > 0 AND min_accuracy_meters <= 5000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_work_locations_name_unique UNIQUE (client_id, name)
)
;
CREATE INDEX workforce_work_locations_client_active_idx ON public.workforce_work_locations (client_id, active, name)
;
CREATE TRIGGER workforce_work_locations_updated_at BEFORE UPDATE ON public.workforce_work_locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_work_location_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  work_location_id UUID NOT NULL REFERENCES public.workforce_work_locations(id) ON DELETE CASCADE,
  applies_to_all BOOLEAN NOT NULL DEFAULT false,
  resource_id UUID REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_work_location_assignment_target CHECK (((CASE WHEN applies_to_all THEN 1 ELSE 0 END) + (CASE WHEN resource_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN user_node_id IS NOT NULL THEN 1 ELSE 0 END)) = 1)
)
;
CREATE INDEX workforce_work_location_assignments_client_idx ON public.workforce_work_location_assignments (client_id, active)
;
CREATE INDEX workforce_work_location_assignments_location_idx ON public.workforce_work_location_assignments (work_location_id)
;
CREATE INDEX workforce_work_location_assignments_resource_idx ON public.workforce_work_location_assignments (client_id, resource_id, active)
;
CREATE INDEX workforce_work_location_assignments_user_idx ON public.workforce_work_location_assignments (client_id, user_node_id, active)
;
CREATE TABLE public.workforce_punch_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  punch_id UUID NOT NULL REFERENCES public.workforce_punches(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'self_service' CHECK (source IN ('manual','kiosk','mobile','self_service','system','import')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_punch_breaks_time_order CHECK (ended_at IS NULL OR ended_at > started_at)
)
;
CREATE INDEX workforce_punch_breaks_client_resource_idx ON public.workforce_punch_breaks (client_id, resource_id, started_at DESC)
;
CREATE INDEX workforce_punch_breaks_open_idx ON public.workforce_punch_breaks (client_id, punch_id) WHERE ended_at IS NULL
;
CREATE TRIGGER workforce_punch_breaks_updated_at BEFORE UPDATE ON public.workforce_punch_breaks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
ALTER TABLE public.workforce_time_clock_events DROP CONSTRAINT IF EXISTS workforce_time_clock_events_event_type_check
;
ALTER TABLE public.workforce_time_clock_events ADD CONSTRAINT workforce_time_clock_events_event_type_check CHECK (event_type IN ('clock_in','clock_out','break_start','break_end','correction','absence','note'))
;
ALTER TABLE public.workforce_time_clock_events DROP CONSTRAINT IF EXISTS workforce_time_clock_events_source_check
;
ALTER TABLE public.workforce_time_clock_events ADD CONSTRAINT workforce_time_clock_events_source_check CHECK (source IN ('manual','kiosk','mobile','self_service','system','import'))
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN work_location_id UUID REFERENCES public.workforce_work_locations(id) ON DELETE SET NULL
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN latitude NUMERIC(9,6)
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN longitude NUMERIC(9,6)
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN accuracy_meters NUMERIC(8,2)
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN distance_meters NUMERIC(10,2)
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN geofence_result TEXT CHECK (geofence_result IS NULL OR geofence_result IN ('not_required','passed','failed','accuracy_rejected','unconfigured'))
;
CREATE INDEX workforce_time_clock_events_geofence_idx ON public.workforce_time_clock_events (client_id, work_location_id, occurred_at DESC)
;
