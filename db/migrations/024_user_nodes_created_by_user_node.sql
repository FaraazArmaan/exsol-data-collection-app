-- 024: created_by_user_node — parallel attribution for bucket-user creators.
--
-- created_by_admin captures admin-initiated row creation; this column
-- captures bucket-user-initiated row creation (Owner adding a team member
-- from Manage Team). Exactly one of {created_by_admin, created_by_user_node}
-- is non-NULL for any new row; older rows (pre-024) may have NULL on this
-- column with non-NULL created_by_admin.

ALTER TABLE public.user_nodes
  ADD COLUMN created_by_user_node UUID NULL REFERENCES public.user_nodes(id);

ALTER TABLE public.user_node_credentials
  ADD COLUMN created_by_user_node UUID NULL REFERENCES public.user_nodes(id);
