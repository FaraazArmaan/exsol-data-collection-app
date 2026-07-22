-- Presentation-only workspace preferences. They never grant access or remove required actions.
CREATE TABLE public.workspace_layout_defaults (
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (namespace ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  layout JSONB NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  updated_by_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, namespace)
)
;
CREATE TABLE public.user_workspace_layout_preferences (
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (namespace ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  layout JSONB NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_node_id, namespace)
)
;
CREATE INDEX user_workspace_layout_preferences_client_idx ON public.user_workspace_layout_preferences (client_id, user_node_id)
;
CREATE TRIGGER workspace_layout_defaults_updated_at BEFORE UPDATE ON public.workspace_layout_defaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TRIGGER user_workspace_layout_preferences_updated_at BEFORE UPDATE ON public.user_workspace_layout_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
