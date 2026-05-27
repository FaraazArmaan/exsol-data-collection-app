CREATE TABLE public.client_cardinality_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_role_id  uuid REFERENCES public.client_roles(id) ON DELETE CASCADE,
  child_role_id   uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  max_children    integer NOT NULL CHECK (max_children >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardinality_unique_top UNIQUE (client_id, parent_role_id, child_role_id)
);
