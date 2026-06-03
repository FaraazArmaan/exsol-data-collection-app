ALTER TABLE public.client_roles
  ADD COLUMN bucket_family TEXT
  CHECK (bucket_family IS NULL OR bucket_family IN ('business', 'employees', 'customers', 'products'));
-- Optional mapping from a Client's custom Role to an abstract DataBucket.
-- NULL means "treat as employees" — sensible default for staff-shaped roles.
