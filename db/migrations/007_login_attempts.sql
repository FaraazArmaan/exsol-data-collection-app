CREATE TABLE public.login_attempts (
  id           bigserial PRIMARY KEY,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  email        citext,
  ip           inet,
  outcome      text NOT NULL CHECK (outcome IN ('failed', 'success'))
);
CREATE INDEX login_attempts_email_time_idx ON public.login_attempts (email, attempted_at DESC) WHERE outcome = 'failed';
CREATE INDEX login_attempts_ip_time_idx ON public.login_attempts (ip, attempted_at DESC) WHERE outcome = 'failed';
