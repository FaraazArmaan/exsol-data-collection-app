ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_marketplace_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_lockouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON workspaces
  USING (is_admin_context() OR id = current_workspace_id())
  WITH CHECK (is_admin_context() OR id = current_workspace_id());

CREATE POLICY ws_isolation ON workspace_memberships
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON categories
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON products
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON product_marketplace_fields
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON stock_movements
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON audit_events
  USING (is_admin_context() OR workspace_id = current_workspace_id() OR workspace_id IS NULL)
  WITH CHECK (true);

CREATE POLICY ws_isolation ON files
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON export_jobs
  USING (row_in_current_workspace(workspace_id))
  WITH CHECK (row_in_current_workspace(workspace_id));

CREATE POLICY ws_isolation ON backups
  USING (
    is_admin_context()
    OR (workspace_id IS NOT NULL AND workspace_id = current_workspace_id())
  )
  WITH CHECK (
    is_admin_context()
    OR (workspace_id IS NOT NULL AND workspace_id = current_workspace_id())
  );

CREATE POLICY ws_isolation ON impersonation_sessions
  USING (
    is_admin_context()
    OR target_user_id = current_user_id()
    OR workspace_id = current_workspace_id()
  )
  WITH CHECK (is_admin_context());

CREATE POLICY ws_isolation ON workspace_unlocks
  USING (is_admin_context())
  WITH CHECK (is_admin_context());

CREATE POLICY ws_isolation ON workspace_lockouts
  USING (is_admin_context())
  WITH CHECK (is_admin_context());
