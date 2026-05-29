ALTER TABLE public.user_node_credentials ADD COLUMN google_sub text;

CREATE UNIQUE INDEX user_node_credentials_google_sub_per_client_idx
  ON public.user_node_credentials (client_id, google_sub)
  WHERE google_sub IS NOT NULL
