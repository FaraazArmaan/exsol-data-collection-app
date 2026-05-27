CREATE TABLE public.user_nodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES public.user_nodes(id) ON DELETE RESTRICT,
  level_number        integer,
  role_id             uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE RESTRICT,
  display_name        text NOT NULL,
  email               citext,
  phone               text,
  notes               text,
  fields              jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by_admin    uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT user_nodes_parent_level_consistency CHECK (
    (level_number IS NULL AND parent_id IS NULL) OR
    (level_number = 1 AND parent_id IS NULL) OR
    (level_number > 1 AND parent_id IS NOT NULL)
  )
);

CREATE INDEX user_nodes_client_parent_idx ON public.user_nodes (client_id, parent_id);
CREATE INDEX user_nodes_client_level_idx  ON public.user_nodes (client_id, level_number);
CREATE UNIQUE INDEX user_nodes_email_per_client_idx
  ON public.user_nodes (client_id, lower(email::text)) WHERE email IS NOT NULL;
