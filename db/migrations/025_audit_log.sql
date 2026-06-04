-- Migration 025: schema_ops_log → audit_log with modern columns.
-- Table is empty (zero rows verified pre-migration) + zero code references
-- the old name, so the rename is a free clarity win.

ALTER TABLE public.schema_ops_log RENAME TO audit_log;

-- Drop dead per-client-schema-era columns.
ALTER TABLE public.audit_log DROP COLUMN schema_name;
ALTER TABLE public.audit_log DROP COLUMN template_key;
ALTER TABLE public.audit_log DROP COLUMN from_version;
ALTER TABLE public.audit_log DROP COLUMN to_version;

-- Add current-semantics columns.
ALTER TABLE public.audit_log
  ADD COLUMN actor_user_node uuid REFERENCES public.user_nodes(id);
ALTER TABLE public.audit_log
  ADD COLUMN target_type text;
ALTER TABLE public.audit_log
  ADD COLUMN target_id text;

-- Indexes for the two most common queries: (a) recent by actor,
-- (b) "show me everything that touched <type:id>".
CREATE INDEX audit_log_occurred_actor_idx
  ON public.audit_log (occurred_at DESC, actor_admin);
CREATE INDEX audit_log_target_idx
  ON public.audit_log (target_type, target_id);
