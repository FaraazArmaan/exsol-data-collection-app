-- 143_login_ams_account_lifecycle.sql - disabled/locked account lifecycle metadata.

ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;
ALTER TABLE public.user_node_credentials ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE public.user_node_credentials ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE public.user_node_credentials ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE public.user_node_credentials ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;
CREATE INDEX IF NOT EXISTS admins_disabled_idx ON public.admins (disabled_at) WHERE disabled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_node_credentials_disabled_idx ON public.user_node_credentials (client_id, disabled_at) WHERE disabled_at IS NOT NULL;
