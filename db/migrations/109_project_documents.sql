-- Project Document Hub (mig 109): join table linking existing files to projects.
-- No new storage: reuses existing public.files records.
CREATE TABLE public.project_files (
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_id     UUID        NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attached_by UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, file_id)
)
;
CREATE INDEX project_files_project_idx
  ON public.project_files (project_id, attached_at DESC)
;
