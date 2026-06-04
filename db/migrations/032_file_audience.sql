-- Migration 032: per-tier audience join tables.
-- See spec §4.3. Used by the tier-visibility WHERE clause in
-- _shared/files-access.ts.

CREATE TABLE public.file_allowed_roles (
  file_id uuid NOT NULL REFERENCES public.files(id)        ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, role_id)
);

CREATE TABLE public.file_allowed_nodes (
  file_id uuid NOT NULL REFERENCES public.files(id)      ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, node_id)
);

CREATE TABLE public.file_allowed_users (
  file_id      uuid NOT NULL REFERENCES public.files(id)      ON DELETE CASCADE,
  user_node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, user_node_id)
);
