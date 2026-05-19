CREATE OR REPLACE FUNCTION is_member_of(ws_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE user_id = current_user_id() AND workspace_id = ws_id
  )
$$;

DROP POLICY IF EXISTS ws_isolation ON workspaces;
CREATE POLICY ws_isolation ON workspaces
  USING (
    is_admin_context()
    OR id = current_workspace_id()
    OR is_member_of(id)
  )
  WITH CHECK (
    is_admin_context()
    OR id = current_workspace_id()
  );

DROP POLICY IF EXISTS ws_isolation ON workspace_memberships;
CREATE POLICY ws_isolation ON workspace_memberships
  USING (
    is_admin_context()
    OR user_id = current_user_id()
    OR workspace_id = current_workspace_id()
  )
  WITH CHECK (
    is_admin_context()
    OR workspace_id = current_workspace_id()
  );
