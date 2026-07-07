-- 120_hr_checklists.sql — onboarding/offboarding checklists over user_nodes.
-- One schema, `kind` discriminator carries both flows. People stay canonical in
-- user_nodes: instances reference the subject by FK (ON DELETE SET NULL) and keep
-- a subject_name snapshot so an offboarding record survives the person's deletion.

CREATE TABLE IF NOT EXISTS public.hr_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_checklist_templates_kind_chk CHECK (kind IN ('onboarding', 'offboarding'))
);

CREATE TABLE IF NOT EXISTS public.hr_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.hr_checklist_templates(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  description text,
  action_hint text
);

CREATE TABLE IF NOT EXISTS public.hr_checklist_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  subject_user_node_id uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  subject_name text NOT NULL,
  template_id uuid REFERENCES public.hr_checklist_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  created_by_user_node uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT hr_checklist_instances_kind_chk CHECK (kind IN ('onboarding', 'offboarding')),
  CONSTRAINT hr_checklist_instances_status_chk CHECK (status IN ('open', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS public.hr_checklist_instance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.hr_checklist_instances(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  description text,
  action_hint text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by_user_node uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS hr_checklist_instances_client_idx ON public.hr_checklist_instances (client_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_checklist_template_items_tpl_idx ON public.hr_checklist_template_items (template_id, position);
CREATE INDEX IF NOT EXISTS hr_checklist_instance_items_inst_idx ON public.hr_checklist_instance_items (instance_id, position);
