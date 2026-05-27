CREATE TABLE public.client_levels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  level_number        integer NOT NULL CHECK (level_number > 0),
  label               text,
  allowed_role_ids    uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_levels_number_per_client_unique UNIQUE (client_id, level_number)
);
