-- 142_login_ams_admin_rbac.sql - platform admin roles and least-privilege gates.

ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'support', 'billing', 'read_only', 'security_admin'));
CREATE INDEX IF NOT EXISTS admins_role_idx ON public.admins (role);
