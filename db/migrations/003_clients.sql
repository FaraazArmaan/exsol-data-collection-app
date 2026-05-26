CREATE TABLE public.clients (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  template_key              text NOT NULL,
  template_version_applied  integer NOT NULL,
  schema_name               text NOT NULL UNIQUE,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT clients_schema_name_format
    CHECK (schema_name ~ '^client_[0-9a-f]{32}$')
);
CREATE INDEX clients_template_key_idx ON public.clients(template_key);
