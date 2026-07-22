-- Workforce X06: dated schedule snapshots, publication state, and employee acknowledgement.
CREATE TABLE public.workforce_schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded')),
  acknowledgement_required BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  published_by UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
CREATE INDEX workforce_schedule_versions_client_week_idx ON public.workforce_schedule_versions (client_id, week_start DESC, created_at DESC)
;
CREATE UNIQUE INDEX workforce_schedule_versions_one_published_week_idx ON public.workforce_schedule_versions (client_id, week_start) WHERE status = 'published'
;
CREATE TABLE public.workforce_schedule_version_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  schedule_version_id UUID NOT NULL REFERENCES public.workforce_schedule_versions(id) ON DELETE CASCADE,
  source_shift_id UUID REFERENCES public.workforce_shifts(id) ON DELETE SET NULL,
  resource_id UUID NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  user_node_id UUID REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_schedule_version_shift_time_order CHECK (end_time > start_time),
  CONSTRAINT workforce_schedule_version_shift_unique UNIQUE (schedule_version_id, resource_id, shift_date, start_time, end_time)
)
;
CREATE INDEX workforce_schedule_version_shifts_client_user_date_idx ON public.workforce_schedule_version_shifts (client_id, user_node_id, shift_date)
;
CREATE INDEX workforce_schedule_version_shifts_version_date_idx ON public.workforce_schedule_version_shifts (schedule_version_id, shift_date, start_time)
;
CREATE TABLE public.workforce_schedule_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  schedule_version_id UUID NOT NULL REFERENCES public.workforce_schedule_versions(id) ON DELETE CASCADE,
  user_node_id UUID NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  acknowledgement_required BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_schedule_notice_unique UNIQUE (schedule_version_id, user_node_id)
)
;
CREATE INDEX workforce_schedule_notices_client_user_idx ON public.workforce_schedule_notices (client_id, user_node_id, acknowledged_at)
;
