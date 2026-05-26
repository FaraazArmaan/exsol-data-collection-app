CREATE TABLE public.bucket_user_credentials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role_key                    text NOT NULL,
  bucket_user_id              uuid NOT NULL,
  email                       citext NOT NULL,
  password_hash               text NOT NULL,
  must_change_password        boolean NOT NULL DEFAULT true,
  temp_password_plain         text,
  temp_password_views_left    integer,
  last_login_at               timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_admin            uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT bucket_user_credentials_email_per_client_unique UNIQUE (client_id, email),
  CONSTRAINT bucket_user_credentials_bucket_user_unique UNIQUE (client_id, role_key, bucket_user_id)
);

CREATE INDEX bucket_user_credentials_email_idx ON public.bucket_user_credentials (client_id, email);

CREATE TRIGGER bucket_user_credentials_set_updated_at
  BEFORE UPDATE ON public.bucket_user_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
