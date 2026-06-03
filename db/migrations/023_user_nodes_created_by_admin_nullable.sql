ALTER TABLE public.user_nodes
  ALTER COLUMN created_by_admin DROP NOT NULL;
ALTER TABLE public.user_node_credentials
  ALTER COLUMN created_by_admin DROP NOT NULL;
-- 023: Relax created_by_admin NOT NULL on user_nodes and user_node_credentials.
--
-- Bucket-user-initiated row creation (Owner adding a team member from the
-- Manage Team UI) has no admin to attribute the row to. The column stays
-- as an FK so admin-created rows continue to attribute correctly; NULL just
-- means "created by a bucket-user".
--
-- The 'created_by' attribution for bucket-user creators is intentionally NOT
-- backfilled into a new column in this migration — designing the audit-trail
-- surface is its own future feature. For now, NULL == "created from outside
-- the admin auth path".
