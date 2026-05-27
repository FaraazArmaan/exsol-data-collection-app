CREATE TABLE public.user_node_credentials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id                uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  email                       citext NOT NULL,
  password_hash               text NOT NULL,
  must_change_password        boolean NOT NULL DEFAULT true,
  temp_password_plain         text,
  temp_password_views_left    integer,
  last_login_at               timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_admin            uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT user_node_credentials_email_per_client_unique UNIQUE (client_id, email),
  CONSTRAINT user_node_credentials_node_unique UNIQUE (user_node_id)
);

CREATE INDEX user_node_credentials_email_idx
  ON public.user_node_credentials (client_id, email);

CREATE TRIGGER user_node_credentials_set_updated_at
  BEFORE UPDATE ON public.user_node_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
