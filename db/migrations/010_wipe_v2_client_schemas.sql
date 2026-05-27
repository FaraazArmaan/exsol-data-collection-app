DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT nspname FROM pg_namespace
    WHERE nspname ~ '^client_[0-9a-f]{32}$'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', r.nspname);
  END LOOP;
  TRUNCATE TABLE public.clients CASCADE;
END $$;
