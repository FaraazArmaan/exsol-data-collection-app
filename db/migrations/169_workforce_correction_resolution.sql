-- Workforce X04: preserve correction review evidence and its payable adjustment link.
ALTER TABLE public.workforce_time_corrections ADD COLUMN resolution_note TEXT
;
ALTER TABLE public.workforce_time_corrections ADD COLUMN payable_time_entry_id UUID REFERENCES public.workforce_payable_time_entries(id) ON DELETE SET NULL
;
ALTER TABLE public.workforce_time_corrections ADD COLUMN applied_at TIMESTAMPTZ
;
ALTER TABLE public.workforce_time_corrections ADD CONSTRAINT workforce_time_corrections_payable_entry_unique UNIQUE (payable_time_entry_id)
;
CREATE INDEX workforce_time_corrections_review_queue_idx ON public.workforce_time_corrections (client_id, status, created_at DESC)
;
