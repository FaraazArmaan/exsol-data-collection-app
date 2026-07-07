-- Overtime logging with approval workflow (mig 114).
-- status FSM: pending → approved | denied.
-- punch_id optionally links to the clock-in/out record that triggered OT.
CREATE TABLE public.overtime_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id  UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  punch_id      UUID        REFERENCES public.workforce_punches(id) ON DELETE SET NULL,
  ot_date       DATE        NOT NULL,
  ot_hours      NUMERIC(5,2) NOT NULL CHECK (ot_hours > 0),
  reason        TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  handled_by    UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX overtime_entries_client_resource_idx
  ON public.overtime_entries (client_id, resource_id, ot_date DESC)
;
