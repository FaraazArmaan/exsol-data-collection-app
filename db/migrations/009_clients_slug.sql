ALTER TABLE public.clients ADD COLUMN slug text;

UPDATE public.clients
SET slug = regexp_replace(
  regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
  '^-+|-+$', '', 'g'
)
WHERE slug IS NULL;

UPDATE public.clients
SET slug = slug || '-' || substring(id::text, 1, 4)
WHERE slug IS NULL OR slug = '' OR slug !~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$';

UPDATE public.clients c1
SET slug = c1.slug || '-' || substring(c1.id::text, 1, 4)
WHERE EXISTS (
  SELECT 1 FROM public.clients c2
  WHERE c2.slug = c1.slug AND c2.id <> c1.id AND c2.created_at < c1.created_at
);

ALTER TABLE public.clients ALTER COLUMN slug SET NOT NULL;

ALTER TABLE public.clients ADD CONSTRAINT clients_slug_unique UNIQUE (slug);

ALTER TABLE public.clients ADD CONSTRAINT clients_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$');
