CREATE TABLE public.admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text,
  google_sub      text UNIQUE,
  display_name    text NOT NULL,
  is_bootstrap    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_has_at_least_one_credential
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
