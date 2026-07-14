-- Booking Setup stores client-facing onboarding choices and derived reservation defaults.
CREATE TABLE public.booking_setup (
  bucket_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  booking_party_mode TEXT NOT NULL DEFAULT 'any_team_member' CHECK (booking_party_mode IN ('specific_team_member','any_team_member','nobody_specific')),
  bookable_kinds TEXT[] NOT NULL DEFAULT ARRAY['appointment']::TEXT[] CHECK (cardinality(bookable_kinds) > 0 AND bookable_kinds <@ ARRAY['appointment','space','equipment']::TEXT[]),
  extra_capacity_needs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (extra_capacity_needs <@ ARRAY['space','equipment']::TEXT[]),
  availability_source TEXT NOT NULL DEFAULT 'workforce' CHECK (availability_source IN ('workforce','manual')),
  display_labels JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(display_labels) = 'object'),
  reservation_rules JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reservation_rules) = 'object'),
  setup_version INTEGER NOT NULL DEFAULT 1 CHECK (setup_version > 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (booking_party_mode = 'nobody_specific' OR availability_source = 'workforce')
)
;
CREATE TRIGGER booking_setup_updated_at BEFORE UPDATE ON public.booking_setup FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
