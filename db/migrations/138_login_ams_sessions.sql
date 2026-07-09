-- 138_login_ams_sessions.sql — revocable admin and workspace-user login sessions.

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm text NOT NULL CHECK (realm IN ('admin', 'bucket_user')),
  subject_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  user_agent text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK ((realm = 'admin' AND client_id IS NULL) OR (realm = 'bucket_user' AND client_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx ON public.auth_sessions (realm, subject_id, client_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_subject_idx ON public.auth_sessions (realm, subject_id, created_at DESC);
