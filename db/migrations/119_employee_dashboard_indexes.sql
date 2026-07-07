-- Performance indexes for Employee Dashboard aggregate queries (mig 119).
-- Supports per-user_node queries across punches and timesheet entries.
CREATE INDEX IF NOT EXISTS workforce_punches_user_node_date_idx
  ON public.workforce_punches (client_id, user_node_id, punched_in_at DESC)
;
CREATE INDEX IF NOT EXISTS timesheet_entries_user_node_date_idx
  ON public.timesheet_entries (client_id, user_node_id, entry_date DESC)
;
