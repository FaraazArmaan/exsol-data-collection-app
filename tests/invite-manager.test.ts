import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  createInvite,
  acceptInvite,
  getInviteByToken,
  listInvites,
  revokeInvite,
} from '../src/lib/invite-manager.ts';
import { pool, shutdown } from '../src/lib/db.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '88888888-8888-8888-8888-888888888888';
const inviterId = '88888888-aaaa-aaaa-aaaa-888888888888';
const accepterId = '88888888-bbbb-bbbb-bbbb-888888888888';

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM invites WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id IN ($1, $2)`, [inviterId, accepterId]);

    await c.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'inviter@invite.test', 'Inviter'), ($2, 'accepter@invite.test', 'Accepter')`,
      [inviterId, accepterId],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Invite WS', $2, 'h')`,
      [wsId, inviterId],
    );
    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, 'primary', now())`,
      [inviterId, wsId],
    );
  } finally {
    c.release();
  }
}

describe('inviteManager (requires TEST_DATABASE_URL)', () => {
  beforeAll(async () => {
    if (!hasTestDb) return;
    await reset();
  });

  beforeEach(async () => {
    if (!hasTestDb) return;
    await reset();
  });

  afterAll(async () => {
    if (hasTestDb) await shutdown();
  });

  dbIt('createInvite returns a raw token and persists only its hash', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.invite.email).toBe('new@example.com');
    expect(r.invite.role).toBe('manager');
    expect(r.invite.status).toBe('pending');
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // raw token never stored
    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const row = await c.query(`SELECT token_hash FROM invites WHERE id = $1`, [r.invite.id]);
      await c.query(`COMMIT`);
      expect(row.rows[0].token_hash).not.toBe(r.token);
      expect(row.rows[0].token_hash.length).toBeGreaterThan(20);
    } finally {
      c.release();
    }
  });

  dbIt('rejects invalid role', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'admin' as never,
      invitedBy: inviterId,
    });
    expect(r).toEqual({ error: 'invalid_role' });
  });

  dbIt('rejects invalid email', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'notanemail',
      role: 'manager',
      invitedBy: inviterId,
    });
    expect(r).toEqual({ error: 'invalid_email' });
  });

  dbIt('getInviteByToken returns the invite for a valid token', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'storekeeper',
      invitedBy: inviterId,
    });
    if ('error' in r) throw new Error('setup failed');
    const got = await getInviteByToken(r.token);
    expect(got?.id).toBe(r.invite.id);
    expect(got?.email).toBe('new@example.com');
  });

  dbIt('getInviteByToken returns null for an unknown token', async () => {
    const got = await getInviteByToken('definitely-not-a-real-token');
    expect(got).toBe(null);
  });

  dbIt('acceptInvite consumes the invite and creates the membership', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'storekeeper',
      invitedBy: inviterId,
    });
    if ('error' in r) throw new Error('setup failed');

    const accepted = await acceptInvite(r.token, accepterId);
    expect('error' in accepted).toBe(false);
    if ('error' in accepted) return;
    expect(accepted.invite.status).toBe('accepted');

    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const m = await c.query(
        `SELECT role, accepted_at FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2`,
        [accepterId, wsId],
      );
      await c.query(`COMMIT`);
      expect(m.rows[0].role).toBe('storekeeper');
      expect(m.rows[0].accepted_at).not.toBe(null);
    } finally {
      c.release();
    }
  });

  dbIt('acceptInvite twice fails the second time', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    if ('error' in r) throw new Error('setup failed');
    await acceptInvite(r.token, accepterId);
    const second = await acceptInvite(r.token, accepterId);
    expect(second).toEqual({ error: 'already_accepted' });
  });

  dbIt('revokeInvite marks the invite revoked; accept then fails', async () => {
    const r = await createInvite({
      workspaceId: wsId,
      email: 'new@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    if ('error' in r) throw new Error('setup failed');
    const rev = await revokeInvite(wsId, r.invite.id, inviterId);
    expect('error' in rev).toBe(false);
    const tryAccept = await acceptInvite(r.token, accepterId);
    expect(tryAccept).toEqual({ error: 'revoked' });
  });

  dbIt('listInvites returns invites for the workspace', async () => {
    await createInvite({
      workspaceId: wsId, email: 'a@example.com', role: 'manager', invitedBy: inviterId,
    });
    await createInvite({
      workspaceId: wsId, email: 'b@example.com', role: 'storekeeper', invitedBy: inviterId,
    });
    const r = await listInvites(wsId, inviterId);
    expect(r.length).toBe(2);
    expect(r.map(i => i.email).sort()).toEqual(['a@example.com', 'b@example.com']);
  });
});
