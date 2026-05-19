CREATE TABLE audit_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id        uuid NOT NULL REFERENCES users(id),
  on_behalf_of         uuid REFERENCES users(id),
  impersonation_reason text,
  action               text NOT NULL,
  resource_type        text,
  resource_id          uuid,
  before_data          jsonb,
  after_data           jsonb,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_workspace ON audit_events(workspace_id, occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_events(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id, occurred_at DESC);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  ip          inet,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_active ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE TABLE email_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE impersonation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid NOT NULL REFERENCES users(id),
  target_user_id  uuid NOT NULL REFERENCES users(id),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  reason          text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  ended_at        timestamptz
);

CREATE INDEX idx_imp_active ON impersonation_sessions(admin_user_id) WHERE ended_at IS NULL;

CREATE TABLE workspace_unlocks (
  admin_user_id     uuid NOT NULL REFERENCES users(id),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  unlocked_at       timestamptz NOT NULL DEFAULT now(),
  last_extended_at  timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  PRIMARY KEY (admin_user_id, workspace_id)
);

CREATE TABLE unlock_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  succeeded     boolean NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_unlock_attempts_recent
  ON unlock_attempts(admin_user_id, workspace_id, attempted_at DESC);

CREATE TABLE workspace_lockouts (
  admin_user_id uuid NOT NULL REFERENCES users(id),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  locked_until  timestamptz NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, workspace_id)
);
