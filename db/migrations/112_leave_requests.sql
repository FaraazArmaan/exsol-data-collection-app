-- Leave request and leave balance tables for Workforce module (mig 112).
-- leave_type: annual / sick / personal / unpaid.
-- Status FSM: pending → approved | denied (handled_by + handled_at on transition).
CREATE TABLE public.leave_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id  UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  leave_type    TEXT        NOT NULL CHECK (leave_type IN ('annual','sick','personal','unpaid')),
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  notes         TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  handled_by    UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date)
)
;
CREATE INDEX leave_requests_client_resource_idx
  ON public.leave_requests (client_id, resource_id, start_date DESC)
;
-- Leave balances: one row per (client, resource, leave_type). Adjusted manually by managers.
CREATE TABLE public.leave_balances (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  leave_type    TEXT        NOT NULL CHECK (leave_type IN ('annual','sick','personal','unpaid')),
  balance_days  NUMERIC(6,1) NOT NULL DEFAULT 0 CHECK (balance_days >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_balances_resource_type_unique UNIQUE (client_id, resource_id, leave_type)
)
;
