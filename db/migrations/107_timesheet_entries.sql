-- Timesheet entries (ERP9 Project Manager depth range 107-111): track billable time
-- worked by a user on a booking resource for a client, with an approval workflow.
-- Extracted from migration 059 (which was already applied on dev+prod before this table
-- was added) into its own file so the migrate runner actually creates it on prod.
-- IF NOT EXISTS makes it a safe no-op on dev, where 059's out-of-band edit already created it.
CREATE TABLE IF NOT EXISTS public.timesheet_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id  UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  entry_date    DATE        NOT NULL,
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  notes         TEXT,
  approved_by   UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_entries_time_order CHECK (end_time > start_time)
)
;
CREATE INDEX IF NOT EXISTS timesheet_entries_client_resource_date_idx
  ON public.timesheet_entries (client_id, resource_id, entry_date DESC)
;
