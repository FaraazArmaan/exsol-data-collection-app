-- 059_workforce.sql — Workforce + Project Service module (migration 059).
-- Slice 1 — workforce_shifts: recurring weekly staff shifts on booking_resources.
-- Slice 2 — projects + project_assignments: project FSM + resource assignment.
-- Projects carry an optional link to crm_customers (from CRM 055, applied separately).
-- MERGE DEPENDENCY: this migration requires crm_customers (CRM 055) on the target branch.

-- Recurring weekly shift: which user works on which booking resource, what weekday/hours.
-- weekday 0=Sun … 6=Sat (matches JS Date.getDay()). start_time/end_time are clock times
-- (TIME, no tz) because shifts repeat on the same day-of-week each week.
CREATE TABLE public.workforce_shifts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id  UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  weekday       SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_shifts_time_order CHECK (end_time > start_time)
)
;
CREATE INDEX workforce_shifts_client_resource_idx
  ON public.workforce_shifts (client_id, resource_id, weekday)
;

-- Project: a named engagement for a client, optionally linked to a CRM customer.
-- Status FSM: quoted → active → done (forward-only transitions enforced in the handler).
CREATE TABLE public.projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  customer_id UUID        REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'quoted'
                CHECK (status IN ('quoted', 'active', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX projects_client_status_idx
  ON public.projects (client_id, status, created_at DESC)
;

-- Project assignments: which booking resource (room/staff) is assigned to a project.
CREATE TABLE public.project_assignments (
  project_id    UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, resource_id)
)
;
