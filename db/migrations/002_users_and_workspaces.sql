CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  name            text NOT NULL,
  photo_url       text,
  google_sub      text UNIQUE,
  password_hash   text,
  email_verified  boolean NOT NULL DEFAULT false,
  is_admin        boolean NOT NULL DEFAULT false,
  disabled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  primary_user_id          uuid NOT NULL REFERENCES users(id),
  currency                 text NOT NULL DEFAULT 'INR',
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  theme_default            text NOT NULL DEFAULT 'light',
  low_stock_default        integer NOT NULL DEFAULT 5,
  dead_stock_days_default  integer NOT NULL DEFAULT 60,
  drive_folder_id          text,
  admin_access_key_hash    text NOT NULL,
  key_rotated_at           timestamptz NOT NULL DEFAULT now(),
  disabled_at              timestamptz,
  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE workspace_role AS ENUM ('primary', 'manager', 'storekeeper');

CREATE TABLE workspace_memberships (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL,
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX idx_memberships_workspace ON workspace_memberships(workspace_id);
