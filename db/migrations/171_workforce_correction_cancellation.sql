-- Workforce X05: retain employee-cancelled corrections in their request history.
ALTER TABLE public.workforce_time_corrections DROP CONSTRAINT workforce_time_corrections_status_check
;
ALTER TABLE public.workforce_time_corrections ADD CONSTRAINT workforce_time_corrections_status_check CHECK (status IN ('pending','approved','denied','cancelled'))
;
