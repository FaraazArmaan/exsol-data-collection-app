-- Workforce X09: explicit grants and audit evidence for sensitive employee data.
CREATE TABLE public.workforce_sensitive_data_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  data_scope TEXT NOT NULL CHECK (data_scope IN ('profile', 'compensation', 'location_history')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  active BOOLEAN NOT NULL DEFAULT true,
  granted_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_sensitive_data_grants_unique UNIQUE (client_id, user_node_id, data_scope)
)
;
CREATE INDEX workforce_sensitive_data_grants_lookup_idx ON public.workforce_sensitive_data_grants (client_id, user_node_id, data_scope) WHERE active = true
;
CREATE TRIGGER workforce_sensitive_data_grants_updated_at BEFORE UPDATE ON public.workforce_sensitive_data_grants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_sensitive_data_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  data_scope TEXT NOT NULL CHECK (data_scope IN ('profile', 'compensation', 'location_history')),
  subject_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  access_basis TEXT NOT NULL CHECK (access_basis IN ('owner', 'direct_manager', 'grant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_sensitive_data_access_events_client_idx ON public.workforce_sensitive_data_access_events (client_id, data_scope, created_at DESC)
;
