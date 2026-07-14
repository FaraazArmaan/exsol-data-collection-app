-- Workspace-configurable rules. Visits retain a full policy snapshot so future edits are not retroactive.
CREATE TABLE public.booking_policies (
  bucket_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  cancel_cutoff_min INTEGER NOT NULL DEFAULT 1440 CHECK (cancel_cutoff_min >= 0),
  reschedule_cutoff_min INTEGER NOT NULL DEFAULT 1440 CHECK (reschedule_cutoff_min >= 0),
  max_customer_reschedules INTEGER NOT NULL DEFAULT 3 CHECK (max_customer_reschedules BETWEEN 0 AND 20),
  late_arrival_grace_min INTEGER NOT NULL DEFAULT 15 CHECK (late_arrival_grace_min >= 0),
  no_show_outcome TEXT NOT NULL DEFAULT 'staff_review' CHECK (no_show_outcome IN ('staff_review', 'automatic_no_show')),
  cancellation_settlement TEXT NOT NULL DEFAULT 'forfeit_deposit' CHECK (cancellation_settlement IN ('forfeit_deposit', 'refund_deposit', 'credit_deposit')),
  late_reschedule_action TEXT NOT NULL DEFAULT 'staff_approval' CHECK (late_reschedule_action IN ('disallow', 'staff_approval')),
  late_reschedule_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (late_reschedule_fee_cents >= 0),
  deposit_requirement TEXT NOT NULL DEFAULT 'service_defined' CHECK (deposit_requirement IN ('none', 'service_defined', 'required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;

-- Existing workspaces receive the industry-standard defaults and can edit them immediately.
INSERT INTO public.booking_policies (bucket_id)
SELECT id FROM public.clients
ON CONFLICT (bucket_id) DO NOTHING
;

-- Each visit carries the exact rules accepted when it was created.
ALTER TABLE public.booking_visits
  ADD COLUMN policy_snapshot JSONB NOT NULL DEFAULT '{"version":1,"cancel_cutoff_min":1440,"reschedule_cutoff_min":1440,"max_customer_reschedules":3,"late_arrival_grace_min":15,"no_show_outcome":"staff_review","cancellation_settlement":"forfeit_deposit","late_reschedule_action":"staff_approval","late_reschedule_fee_cents":0,"deposit_requirement":"service_defined"}'::jsonb
;
ALTER TABLE public.booking_visits
  ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0)
;
UPDATE public.booking_visits v
SET policy_snapshot = jsonb_build_object(
  'version', p.version,
  'cancel_cutoff_min', p.cancel_cutoff_min,
  'reschedule_cutoff_min', p.reschedule_cutoff_min,
  'max_customer_reschedules', p.max_customer_reschedules,
  'late_arrival_grace_min', p.late_arrival_grace_min,
  'no_show_outcome', p.no_show_outcome,
  'cancellation_settlement', p.cancellation_settlement,
  'late_reschedule_action', p.late_reschedule_action,
  'late_reschedule_fee_cents', p.late_reschedule_fee_cents,
  'deposit_requirement', p.deposit_requirement
)
FROM public.booking_policies p
WHERE p.bucket_id = v.bucket_id
;
