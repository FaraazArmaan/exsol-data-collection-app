-- 066: cache for AI finance insight reports.
-- One report per (client, month). Regenerating upserts. payload holds the
-- narrative + anomalies + health score; is_fallback flags the deterministic
-- rule-based summary produced when ANTHROPIC_API_KEY is absent (dev) or the LLM
-- call fails. Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.finance_ai_reports (
  client_id    UUID NOT NULL,
  month        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  model        TEXT NOT NULL,
  is_fallback  BOOLEAN NOT NULL DEFAULT false,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, month),
  CONSTRAINT finance_ai_reports_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT finance_ai_reports_month_fmt CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')
);
