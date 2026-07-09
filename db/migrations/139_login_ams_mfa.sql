-- 139_login_ams_mfa.sql - admin TOTP MFA enrollment, challenges, and recovery codes.

CREATE TABLE IF NOT EXISTS public.admin_mfa (
  admin_id uuid PRIMARY KEY REFERENCES public.admins(id) ON DELETE CASCADE,
  totp_secret text NOT NULL,
  enabled_at timestamptz,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER admin_mfa_set_updated_at BEFORE UPDATE ON public.admin_mfa FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TABLE IF NOT EXISTS public.admin_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_mfa_challenges_active_idx ON public.admin_mfa_challenges (admin_id, expires_at) WHERE consumed_at IS NULL;
