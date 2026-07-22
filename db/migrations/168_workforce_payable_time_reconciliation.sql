-- Workforce X03: one approved source of payable time for payroll calculation.
CREATE TABLE public.workforce_payable_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes <> 0 AND abs(minutes) <= 1440),
  source_type TEXT NOT NULL CHECK (source_type IN ('approved_timesheet','approved_correction')),
  source_id UUID NOT NULL,
  approved_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_payable_time_source_unique UNIQUE (client_id, source_type, source_id)
)
;
CREATE INDEX workforce_payable_time_client_date_idx ON public.workforce_payable_time_entries (client_id, work_date, user_node_id)
;
CREATE INDEX workforce_payable_time_resource_date_idx ON public.workforce_payable_time_entries (client_id, resource_id, work_date DESC)
;
INSERT INTO public.workforce_payable_time_entries (
  client_id,
  resource_id,
  user_node_id,
  work_date,
  minutes,
  source_type,
  source_id,
  approved_by,
  approved_at,
  notes,
  source_snapshot
)
SELECT
  te.client_id,
  te.resource_id,
  te.user_node_id,
  te.entry_date,
  ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::integer,
  'approved_timesheet',
  te.id,
  te.approved_by,
  te.approved_at,
  te.notes,
  jsonb_build_object(
    'entry_date', to_char(te.entry_date, 'YYYY-MM-DD'),
    'start_time', left(te.start_time::text, 5),
    'end_time', left(te.end_time::text, 5),
    'timesheet_id', te.id
  )
FROM public.timesheet_entries te
WHERE te.approved_at IS NOT NULL
  AND te.user_node_id IS NOT NULL
ON CONFLICT (client_id, source_type, source_id) DO NOTHING
;
