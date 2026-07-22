-- Workforce X07: idempotent attendance commands and supervisor-reviewed geofence recovery.
ALTER TABLE public.workforce_punches ADD COLUMN clock_in_idempotency_key TEXT
;
ALTER TABLE public.workforce_punches ADD COLUMN clock_out_idempotency_key TEXT
;
ALTER TABLE public.workforce_punch_breaks ADD COLUMN start_idempotency_key TEXT
;
ALTER TABLE public.workforce_punch_breaks ADD COLUMN end_idempotency_key TEXT
;
ALTER TABLE public.workforce_time_clock_events ADD COLUMN idempotency_key TEXT
;
CREATE UNIQUE INDEX workforce_punches_clock_in_idempotency_idx ON public.workforce_punches (client_id, user_node_id, clock_in_idempotency_key) WHERE clock_in_idempotency_key IS NOT NULL
;
CREATE UNIQUE INDEX workforce_punches_clock_out_idempotency_idx ON public.workforce_punches (client_id, user_node_id, clock_out_idempotency_key) WHERE clock_out_idempotency_key IS NOT NULL
;
CREATE UNIQUE INDEX workforce_punch_breaks_start_idempotency_idx ON public.workforce_punch_breaks (client_id, user_node_id, start_idempotency_key) WHERE start_idempotency_key IS NOT NULL
;
CREATE UNIQUE INDEX workforce_punch_breaks_end_idempotency_idx ON public.workforce_punch_breaks (client_id, user_node_id, end_idempotency_key) WHERE end_idempotency_key IS NOT NULL
;
CREATE UNIQUE INDEX workforce_time_clock_events_idempotency_idx ON public.workforce_time_clock_events (client_id, user_node_id, event_type, idempotency_key) WHERE idempotency_key IS NOT NULL
;
CREATE TABLE public.workforce_attendance_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  action TEXT NOT NULL DEFAULT 'clock_in' CHECK (action IN ('clock_in')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  failure_code TEXT NOT NULL CHECK (failure_code IN ('permission_denied','position_unavailable','location_timeout','outside_geofence','location_accuracy_too_low','geofence_unconfigured','network_error')),
  employee_reason TEXT NOT NULL CHECK (length(trim(employee_reason)) >= 3),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  work_location_id UUID REFERENCES public.workforce_work_locations(id) ON DELETE SET NULL,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  accuracy_meters NUMERIC(8,2),
  distance_meters NUMERIC(10,2),
  geofence_result TEXT CHECK (geofence_result IS NULL OR geofence_result IN ('not_required','passed','failed','accuracy_rejected','unconfigured')),
  request_key TEXT NOT NULL,
  reviewed_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  resolution_note TEXT,
  override_punch_id UUID REFERENCES public.workforce_punches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_attendance_recovery_request_key_unique UNIQUE (client_id, user_node_id, request_key)
)
;
CREATE INDEX workforce_attendance_recovery_pending_idx ON public.workforce_attendance_recovery_requests (client_id, status, created_at ASC)
;
CREATE INDEX workforce_attendance_recovery_employee_idx ON public.workforce_attendance_recovery_requests (client_id, user_node_id, created_at DESC)
;
CREATE TRIGGER workforce_attendance_recovery_requests_updated_at BEFORE UPDATE ON public.workforce_attendance_recovery_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
