ALTER TABLE public.client_levels
  ADD COLUMN permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Sparse map of '<module>.<bucket>.<verb>' or '_platform.<surface>.<verb>'
-- → true. Missing keys default to false. The matrix is server-validated
-- against the active Module manifests on PUT; see client-levels-permissions.
