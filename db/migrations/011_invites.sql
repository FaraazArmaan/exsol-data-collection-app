-- 011_invites.sql
--
-- Email-invite flow for Secondary Users (v1.1 #2). Primary invites by
-- email + role; we mint a random 32-byte token, store its SHA-256 hash,
-- and send the raw token in the link. Accepting consumes the invite
-- and creates the workspace_memberships row.
--
-- The email send itself is feature-flagged behind RESEND_API_KEY at the
-- application layer — when unset, the API returns the link directly so
-- the flow stays end-to-end testable. See src/lib/email-sender.ts.

CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          workspace_role NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  invited_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  status        invite_status NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_invites_workspace ON invites(workspace_id);
CREATE INDEX idx_invites_email ON invites(lower(email));
CREATE INDEX idx_invites_status ON invites(status) WHERE status = 'pending';

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Workspace members + admins see invites for their workspace. The accept
-- endpoint uses an unauthenticated SELECT-by-token-hash path that bypasses
-- RLS via withAdminContext (the token itself is the authentication).
CREATE POLICY invites_workspace_scope ON invites
  FOR ALL
  USING (
    current_setting('app.is_admin', true) = 'true'
    OR workspace_id = (current_setting('app.current_workspace_id', true))::uuid
  );
