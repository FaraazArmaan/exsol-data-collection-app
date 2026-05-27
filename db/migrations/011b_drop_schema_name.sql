ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_schema_name_format;

ALTER TABLE public.clients DROP COLUMN IF EXISTS schema_name
