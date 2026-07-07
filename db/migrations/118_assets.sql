-- Equipment asset inventory and assignment tracking (mig 118).
-- condition: good | fair | poor | retired (retired = soft delete).
CREATE TABLE public.workforce_assets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  description     TEXT,
  serial_number   TEXT,
  condition       TEXT        NOT NULL DEFAULT 'good' CHECK (condition IN ('good','fair','poor','retired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
-- Asset assignments: returned_at NULL means currently assigned.
CREATE TABLE public.asset_assignments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  asset_id        UUID        NOT NULL REFERENCES public.workforce_assets(id) ON DELETE CASCADE,
  user_node_id    UUID        NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at     TIMESTAMPTZ,
  condition_at_return TEXT    CHECK (condition_at_return IN ('good','fair','poor')),
  notes           TEXT,
  CONSTRAINT asset_assignments_return_after_assign CHECK (returned_at IS NULL OR returned_at > assigned_at)
)
;
CREATE INDEX asset_assignments_asset_returned_idx
  ON public.asset_assignments (client_id, asset_id, returned_at)
;
CREATE INDEX asset_assignments_user_node_idx
  ON public.asset_assignments (client_id, user_node_id, returned_at)
;
