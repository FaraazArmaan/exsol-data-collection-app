CREATE TABLE public.schema_ops_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_admin  uuid REFERENCES public.admins(id),
  op           text NOT NULL,
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  schema_name  text NOT NULL,
  template_key text,
  from_version integer,
  to_version   integer,
  detail       jsonb
);
CREATE INDEX schema_ops_log_client_idx ON public.schema_ops_log(client_id);
