CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_workspace_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION is_admin_context() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.is_admin', true) = 'true', false)
$$;

CREATE OR REPLACE FUNCTION row_in_current_workspace(row_ws uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT is_admin_context() OR row_ws = current_workspace_id()
$$;
