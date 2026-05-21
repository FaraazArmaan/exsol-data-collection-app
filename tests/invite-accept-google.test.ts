import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { pool, shutdown } from '../src/lib/db.ts';
import { createInvite } from '../src/lib/invite-manager.ts';

// Mock the Google id-token verifier so tests don't hit Google's servers.
// The endpoint imports this module; vi.mock swaps its implementation before
// the dynamic import inside the endpoint resolves.
vi.mock('../src/lib/google-verifier.ts', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import { verifyGoogleIdToken } from '../src/lib/google-verifier.ts';
import handler from '../netlify/functions/invite-accept-google.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '99999999-9999-9999-9999-999999999999';
const inviterId = '99999999-aaaa-aaaa-aaaa-999999999999';

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM invites WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id = $1 OR email LIKE 'g-invite-%'`, [inviterId]);

    await c.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'g-inviter@invite.test', 'G Inviter')`,
      [inviterId],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'G Invite WS', $2, 'h')`,
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

function mockGoogle(payload: { sub: string; email: string; name: string }) {
  vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    photoUrl: null,
    emailVerified: true,
  });
}

function mockGoogleError(kind: 'invalid_token' | 'misconfigured' | 'email_not_verified') {
  vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({ kind });
}

function fakeRequest(token: string, body: unknown): { req: Request; ctx: any } {
  return {
    req: new Request('http://localhost/api/invites/' + token + '/accept-google', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    ctx: { params: { token } },
  };
}

describe('invite-accept-google (requires TEST_DATABASE_URL)', () => {
  beforeAll(async () => {
    if (!hasTestDb) return;
    await reset();
  });

  beforeEach(async () => {
    if (!hasTestDb) return;
    vi.clearAllMocks();
    await reset();
  });

  afterAll(async () => {
    if (hasTestDb) await shutdown();
  });

  dbIt('happy path: matching Google email accepts invite and creates user with NULL password', async () => {
    const invite = await createInvite({
      workspaceId: wsId,
      email: 'g-invite-1@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    if ('error' in invite) throw new Error('setup failed');

    mockGoogle({ sub: 'google-sub-1', email: 'g-invite-1@example.com', name: 'Google User' });

    const { req, ctx } = fakeRequest(invite.token, { idToken: 'fake-id-token' });
    const res = await handler(req, ctx);
    expect(res.status).toBe(200);

    // Verify the user was created with NULL password and the right google_sub
    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const u = await c.query(
        `SELECT password_hash, google_sub, email, name FROM users WHERE email = $1`,
        ['g-invite-1@example.com'],
      );
      expect(u.rowCount).toBe(1);
      expect(u.rows[0].password_hash).toBe(null);
      expect(u.rows[0].google_sub).toBe('google-sub-1');
      expect(u.rows[0].name).toBe('Google User');

      const m = await c.query(
        `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
        [wsId, 'g-invite-1@example.com'],
      );
      expect(m.rowCount).toBe(1);
      expect(m.rows[0].role).toBe('manager');
      await c.query(`COMMIT`);
    } finally {
      c.release();
    }
  });

  dbIt('strict-match: Google email different from invite email returns email_mismatch and leaves invite pending', async () => {
    const invite = await createInvite({
      workspaceId: wsId,
      email: 'g-invite-2@example.com',
      role: 'storekeeper',
      invitedBy: inviterId,
    });
    if ('error' in invite) throw new Error('setup failed');

    mockGoogle({ sub: 'google-sub-2', email: 'totally-different@gmail.com', name: 'Wrong Person' });

    const { req, ctx } = fakeRequest(invite.token, { idToken: 'fake-id-token' });
    const res = await handler(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('email_mismatch');

    // Invite is still pending; no user was created at either email
    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const inv = await c.query(`SELECT status FROM invites WHERE id = $1`, [invite.invite.id]);
      expect(inv.rows[0].status).toBe('pending');
      const u = await c.query(
        `SELECT email FROM users WHERE email IN ($1, $2)`,
        ['g-invite-2@example.com', 'totally-different@gmail.com'],
      );
      expect(u.rowCount).toBe(0);
      await c.query(`COMMIT`);
    } finally {
      c.release();
    }
  });

  dbIt('existing user with matching email gets google_sub attached', async () => {
    // Pre-seed a user at the invite email who hasn't used Google before
    const c = await pool().connect();
    try {
      await c.query(
        `INSERT INTO users (email, name, password_hash, email_verified)
         VALUES ('g-invite-3@example.com', 'Existing Bob', 'somehash', true)`,
      );
    } finally { c.release(); }

    const invite = await createInvite({
      workspaceId: wsId,
      email: 'g-invite-3@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    if ('error' in invite) throw new Error('setup failed');

    mockGoogle({ sub: 'google-sub-3', email: 'g-invite-3@example.com', name: 'Google Bob' });

    const { req, ctx } = fakeRequest(invite.token, { idToken: 'fake-id-token' });
    const res = await handler(req, ctx);
    expect(res.status).toBe(200);

    // The existing user row was reused; google_sub now set; password_hash UNCHANGED
    const c2 = await pool().connect();
    try {
      await c2.query(`BEGIN`);
      await c2.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const u = await c2.query(
        `SELECT password_hash, google_sub, name FROM users WHERE email = $1`,
        ['g-invite-3@example.com'],
      );
      expect(u.rowCount).toBe(1);
      expect(u.rows[0].password_hash).toBe('somehash'); // unchanged
      expect(u.rows[0].google_sub).toBe('google-sub-3');
      // Don't overwrite name on existing users
      expect(u.rows[0].name).toBe('Existing Bob');
      await c2.query(`COMMIT`);
    } finally {
      c2.release();
    }
  });

  dbIt('rejects invalid Google token without consuming the invite', async () => {
    const invite = await createInvite({
      workspaceId: wsId,
      email: 'g-invite-4@example.com',
      role: 'manager',
      invitedBy: inviterId,
    });
    if ('error' in invite) throw new Error('setup failed');

    mockGoogleError('invalid_token');

    const { req, ctx } = fakeRequest(invite.token, { idToken: 'bogus' });
    const res = await handler(req, ctx);
    expect(res.status).toBe(401);

    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const inv = await c.query(`SELECT status FROM invites WHERE id = $1`, [invite.invite.id]);
      expect(inv.rows[0].status).toBe('pending');
      await c.query(`COMMIT`);
    } finally {
      c.release();
    }
  });
});
