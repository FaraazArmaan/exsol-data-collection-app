-- AI Project Planner (mig 111): persists AI-generated draft task plans so users
-- can review and re-generate before committing to the task tracker.
CREATE TABLE public.project_ai_plans (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id   UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt_text  TEXT        NOT NULL,
  draft_tasks  JSONB       NOT NULL DEFAULT '[]',
  generated_by UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX project_ai_plans_project_idx
  ON public.project_ai_plans (project_id, created_at DESC)
;
