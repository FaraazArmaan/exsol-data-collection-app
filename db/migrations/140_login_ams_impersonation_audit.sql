-- 140_login_ams_impersonation_audit.sql - explicit impersonation session and audit attribution.

ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS impersonated_by_admin uuid REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS impersonation_started_at timestamptz;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS impersonation_reason text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS impersonated_by_admin uuid REFERENCES public.admins(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_impersonation_idx ON public.auth_sessions (impersonated_by_admin, created_at DESC) WHERE impersonated_by_admin IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_impersonated_by_admin_idx ON public.audit_log (impersonated_by_admin, occurred_at DESC) WHERE impersonated_by_admin IS NOT NULL;
