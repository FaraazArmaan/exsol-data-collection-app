-- Workforce X08: shared approval ownership, delegation, and response targets.
CREATE TABLE public.workforce_approval_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('leave','overtime','shift_swap','time_correction','attendance_recovery','payroll')),
  primary_approver_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  response_target_hours INTEGER NOT NULL DEFAULT 24 CHECK (response_target_hours BETWEEN 1 AND 720),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_approval_policies_client_type_unique UNIQUE (client_id, request_type)
)
;
CREATE INDEX workforce_approval_policies_client_active_idx ON public.workforce_approval_policies (client_id, active, request_type)
;
CREATE TRIGGER workforce_approval_policies_updated_at BEFORE UPDATE ON public.workforce_approval_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
;
CREATE TABLE public.workforce_approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  owner_user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  delegate_user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  request_type TEXT CHECK (request_type IS NULL OR request_type IN ('leave','overtime','shift_swap','time_correction','attendance_recovery','payroll')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_approval_delegations_distinct_people CHECK (owner_user_node_id <> delegate_user_node_id),
  CONSTRAINT workforce_approval_delegations_dates CHECK (ends_at IS NULL OR ends_at > starts_at)
)
;
CREATE INDEX workforce_approval_delegations_lookup_idx ON public.workforce_approval_delegations (client_id, owner_user_node_id, delegate_user_node_id, starts_at, ends_at) WHERE revoked_at IS NULL
;
CREATE TABLE public.workforce_approval_routing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  request_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('policy_saved','delegated','revoked','decision_routed')),
  owner_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  actor_user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_approval_routing_events_client_idx ON public.workforce_approval_routing_events (client_id, request_type, created_at DESC)
;
