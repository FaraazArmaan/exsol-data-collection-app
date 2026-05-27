CREATE TABLE public.client_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key            text NOT NULL,
  label          text NOT NULL,
  color          text NOT NULL,
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_roles_key_per_client_unique UNIQUE (client_id, key)
);

CREATE TRIGGER client_roles_set_updated_at
  BEFORE UPDATE ON public.client_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
