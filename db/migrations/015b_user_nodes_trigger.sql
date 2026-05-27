CREATE OR REPLACE FUNCTION public.user_nodes_validate() RETURNS trigger AS $$
DECLARE
  parent_level integer;
  parent_client uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT level_number, client_id INTO parent_level, parent_client
      FROM public.user_nodes WHERE id = NEW.parent_id;
    IF parent_client <> NEW.client_id THEN
      RAISE EXCEPTION 'cross_client_parent';
    END IF;
    IF parent_level IS NULL OR NEW.level_number IS NULL
       OR NEW.level_number <> parent_level + 1 THEN
      RAISE EXCEPTION 'parent_level_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
