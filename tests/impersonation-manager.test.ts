import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { begin, current, end } from '../src/lib/impersonation-manager.ts';
import {
  attemptUnlock,
  generateAndHashKey,
} from '../src/lib/workspace-unlock-manager.ts';
import { pool, shutdown } from '../src/lib/db.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '55555555-5555-5555-5555-555555555555';
const adminId = '55555555-aaaa-aaaa-aaaa-555555555555';
const primaryId = '55555555-bbbb-bbbb-bbbb-555555555555';
const strangerId = '55555555-cccc-cccc-cccc-555555555555';
let key: string;

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM impersonation_sessions WHERE admin_user_id = $1`, [adminId]);
    await c.query(`DELETE FROM workspace_lockouts WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_unlocks WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM unlock_attempts WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [adminId, primaryId, strangerId]);

    await c.query(
      `INSERT INTO users (id, email, name, is_admin) VALUES
       ($1, 'imp-admin@test', 'Admin', true),
       ($2, 'imp-primary@test', 'Primary', false),
       ($3, 'imp-stranger@test', 'Stranger', false)`,
      [adminId, primaryId, strangerId],
    );
    const { plaintext, hash } = await generateAndHashKey();
    key = plaintext;
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Imp WS', $2, $3)`,
      [wsId, primaryId, hash],
    );
    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, 'primary', now())`,
      [primaryId, wsId],
    );
  } finally {
    c.release();
  }
}

describe('impersonationManager (requires TEST_DATABASE_URL)', () => {
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

  dbIt('refuses to start without a written reason', async () => {
    await attemptUnlock(adminId, wsId, key);
    const r = await begin(adminId, primaryId, wsId, '');
    expect(r.kind).toBe('invalid_reason');
    const r2 = await begin(adminId, primaryId, wsId, 'ab');
    expect(r2.kind).toBe('invalid_reason');
  });

  dbIt('refuses to start without an active unlock', async () => {
    const r = await begin(adminId, primaryId, wsId, 'Helping fix product');
    expect(r.kind).toBe('not_unlocked');
  });

  dbIt('refuses to impersonate a non-member of the workspace', async () => {
    await attemptUnlock(adminId, wsId, key);
    const r = await begin(adminId, strangerId, wsId, 'Helping fix product');
    expect(r.kind).toBe('invalid_target');
  });

  dbIt('starts an impersonation session and current() returns it', async () => {
    await attemptUnlock(adminId, wsId, key);
    const r = await begin(adminId, primaryId, wsId, 'Helping fix product export');
    expect(r.kind).toBe('started');

    const cur = await current(adminId);
    expect(cur).not.toBeNull();
    expect(cur?.targetUserId).toBe(primaryId);
    expect(cur?.workspaceId).toBe(wsId);
    expect(cur?.reason).toBe('Helping fix product export');
  });

  dbIt('returns already_active when starting a second session while one is open', async () => {
    await attemptUnlock(adminId, wsId, key);
    await begin(adminId, primaryId, wsId, 'Helping fix product');
    const r = await begin(adminId, primaryId, wsId, 'Another reason');
    expect(r.kind).toBe('already_active');
  });

  dbIt('end() closes the active session and current() returns null', async () => {
    await attemptUnlock(adminId, wsId, key);
    await begin(adminId, primaryId, wsId, 'Helping fix product');
    await end(adminId);
    expect(await current(adminId)).toBeNull();
  });

  dbIt('expired sessions are not returned by current()', async () => {
    await attemptUnlock(adminId, wsId, key);
    const r = await begin(adminId, primaryId, wsId, 'Helping fix product');
    expect(r.kind).toBe('started');

    const c = await pool().connect();
    try {
      await c.query(
        `UPDATE impersonation_sessions SET expires_at = now() - interval '1 minute'
         WHERE admin_user_id = $1`,
        [adminId],
      );
    } finally {
      c.release();
    }
    expect(await current(adminId)).toBeNull();
  });
});
