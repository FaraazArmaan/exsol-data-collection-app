-- Clock-in/clock-out punches with shift-match and late detection (mig 113).
-- Linked to a workforce_shift to compute late_minutes; is_absent flags no-shows.
CREATE TABLE public.workforce_punches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id     UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id    UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  shift_id        UUID        REFERENCES public.workforce_shifts(id) ON DELETE SET NULL,
  punched_in_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  punched_out_at  TIMESTAMPTZ,
  late_minutes    SMALLINT,
  is_absent       BOOLEAN     NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT punch_out_after_in CHECK (punched_out_at IS NULL OR punched_out_at > punched_in_at)
)
;
CREATE INDEX workforce_punches_client_resource_idx
  ON public.workforce_punches (client_id, resource_id, punched_in_at DESC)
;
