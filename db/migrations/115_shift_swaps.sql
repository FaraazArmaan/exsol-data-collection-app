-- Shift swap board (mig 115).
-- Status FSM: open → claimed → approved | denied; open → cancelled.
-- offering_resource_id offers their shift; claimed_by_resource_id accepts.
CREATE TABLE public.shift_swaps (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  offering_shift_id       UUID        NOT NULL REFERENCES public.workforce_shifts(id) ON DELETE CASCADE,
  offering_resource_id    UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  offering_date           DATE        NOT NULL,
  claimed_by_resource_id  UUID        REFERENCES public.booking_resources(id) ON DELETE SET NULL,
  claimed_at              TIMESTAMPTZ,
  status                  TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','approved','denied','cancelled')),
  notes                   TEXT,
  handled_by              UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  handled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX shift_swaps_client_status_idx
  ON public.shift_swaps (client_id, status, offering_date DESC)
;
