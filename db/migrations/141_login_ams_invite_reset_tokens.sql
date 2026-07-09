-- 141_login_ams_invite_reset_tokens.sql - hashed single-use workspace credential tokens.

CREATE TABLE IF NOT EXISTS public.user_credential_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES public.user_node_credentials(id) ON DELETE CASCADE,
  email citext NOT NULL,
  created_by_admin uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  created_by_user_node uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_credential_tokens_lookup_idx ON public.user_credential_tokens (token_hash) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS user_credential_tokens_subject_idx ON public.user_credential_tokens (client_id, user_node_id, created_at DESC);
