-- 103: crm_social_connections — connected social/contact providers per client.
-- Provider-seam MOCK for now (connect/disconnect + contact import are simulated;
-- real OAuth/keys land later, changing only the lib seam). Imported contacts flow
-- into crm_leads (source='social'). One row per (client, provider). Additive.

CREATE TABLE IF NOT EXISTS public.crm_social_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL,
  provider             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'disconnected',
  account_label        TEXT,
  imported_total       INT NOT NULL DEFAULT 0,
  last_imported_at     TIMESTAMPTZ,
  connected_at         TIMESTAMPTZ,
  created_by_user_node UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_social_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT crm_social_creator_fk FOREIGN KEY (created_by_user_node) REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  CONSTRAINT crm_social_provider_chk CHECK (provider IN ('google','mailchimp','facebook')),
  CONSTRAINT crm_social_status_chk CHECK (status IN ('connected','disconnected')),
  CONSTRAINT crm_social_imported_nonneg CHECK (imported_total >= 0),
  CONSTRAINT crm_social_client_provider_uniq UNIQUE (client_id, provider)
);
