-- 036_drop_client_levels_allowed_role_ids.sql
--
-- The allowed_role_ids column was a level-binds-roles constraint that no
-- longer applies after the 2026-06-08 levels/roles decoupling refactor.
-- Roles are now orthogonal to levels — any role can be assigned at any
-- level. The permissions JSON column (added in migration 021) is the only
-- level-bound semantic field.
--
-- Code-deploy precedes this migration on prod; all consumers have already
-- stopped reading or writing the column. See plan T14 for the deploy order.

ALTER TABLE public.client_levels DROP COLUMN allowed_role_ids;
