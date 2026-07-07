-- 102: crm_leads — inbound leads from the public lead-capture form (and, later,
-- social contact imports). A lead is a prospect not yet in crm_customers; staff
-- convert it (creating/merging a crm_customer) or archive it. Requires at least
-- one contact channel (email or phone). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL,
  name                  TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  message               TEXT,
  source                TEXT NOT NULL DEFAULT 'public_form',
  status                TEXT NOT NULL DEFAULT 'new',
  converted_customer_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_leads_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT crm_leads_customer_fk FOREIGN KEY (converted_customer_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  CONSTRAINT crm_leads_status_chk CHECK (status IN ('new','converted','archived')),
  CONSTRAINT crm_leads_source_chk CHECK (source IN ('public_form','social')),
  CONSTRAINT crm_leads_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT crm_leads_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS crm_leads_client_status_idx ON public.crm_leads (client_id, status, created_at DESC);
