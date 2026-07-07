-- Project Tasks + Risk Analytics (mig 110): task tracking per project with
-- due dates, status, and assigned resource — feeds the risk analytics engine.
CREATE TABLE public.project_tasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  assigned_to UUID        REFERENCES public.booking_resources(id) ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'done')),
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX project_tasks_project_status_idx
  ON public.project_tasks (project_id, status, due_date)
;
CREATE INDEX project_tasks_client_idx
  ON public.project_tasks (client_id, project_id)
;
