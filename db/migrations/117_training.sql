-- Training courses and completion tracking (mig 117).
-- Courses may be required; expiry_days drives expires_at computation on completion.
CREATE TABLE public.training_courses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  description     TEXT,
  is_required     BOOLEAN     NOT NULL DEFAULT false,
  expiry_days     INTEGER     CHECK (expiry_days > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
-- One completion per (resource, course). expires_at = completed_at + expiry_days.
CREATE TABLE public.training_completions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  course_id       UUID        NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  resource_id     UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id    UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  completed_at    DATE        NOT NULL,
  expires_at      DATE,
  cert_url        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX training_completions_client_resource_idx
  ON public.training_completions (client_id, resource_id, course_id)
;
