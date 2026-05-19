import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  attemptUnlock,
  extendUnlock,
  generateAndHashKey,
  isUnlocked,
  rotateKey,
} from '../src/lib/workspace-unlock-manager.ts';
import { pool, shutdown } from '../src/lib/db.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '44444444-4444-4444-4444-444444444444';
const adminId = '44444444-aaaa-aaaa-aaaa-444444444444';
let knownKey: string;

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_lockouts WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_unlocks WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM unlock_attempts WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [adminId]);

    await c.query(
      `INSERT INTO users (id, email, name, is_admin)
       VALUES ($1, 'unlock-admin@test', 'Admin', true)`,
      [adminId],
    );
    const { plaintext, hash } = await generateAndHashKey();
    knownKey = plaintext;
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Unlock WS', $2, $3)`,
      [wsId, adminId, hash],
    );
  } finally {
    c.release();
  }
}

describe('workspaceUnlockManager (requires TEST_DATABASE_URL)', () => {
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

  dbIt('returns unlocked on correct key', async () => {
    const res = await attemptUnlock(adminId, wsId, knownKey);
    expect(res.kind).toBe('unlocked');
    expect(await isUnlocked(adminId, wsId)).toBe(true);
  });

  dbIt('returns invalid_key on wrong key', async () => {
    const res = await attemptUnlock(adminId, wsId, 'WRONGWRONGW1');
    expect(res.kind).toBe('invalid_key');
    if (res.kind === 'invalid_key') expect(res.remainingAttempts).toBe(4);
    expect(await isUnlocked(adminId, wsId)).toBe(false);
  });

  dbIt('locks out after 5 failed attempts in 10 minutes', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await attemptUnlock(adminId, wsId, 'WRONGWRONGW1');
      expect(r.kind).toBe('invalid_key');
    }
    const final = await attemptUnlock(adminId, wsId, 'WRONGWRONGW1');
    expect(final.kind).toBe('locked_out');
  });

  dbIt('refuses unlock when locked out, even with correct key', async () => {
    for (let i = 0; i < 5; i++) {
      await attemptUnlock(adminId, wsId, 'WRONGWRONGW1');
    }
    const r = await attemptUnlock(adminId, wsId, knownKey);
    expect(r.kind).toBe('locked_out');
  });

  dbIt('returns workspace_not_found for unknown workspace', async () => {
    const r = await attemptUnlock(adminId, '00000000-0000-0000-0000-000000000000', 'X');
    expect(r.kind).toBe('workspace_not_found');
  });

  dbIt('extendUnlock extends the expiry on an active unlock', async () => {
    await attemptUnlock(adminId, wsId, knownKey);
    const c = await pool().connect();
    try {
      await c.query(
        `UPDATE workspace_unlocks SET expires_at = now() + interval '1 minute'
         WHERE admin_user_id = $1 AND workspace_id = $2`,
        [adminId, wsId],
      );
      await extendUnlock(adminId, wsId);
      const r = await c.query(
        `SELECT expires_at FROM workspace_unlocks
         WHERE admin_user_id = $1 AND workspace_id = $2`,
        [adminId, wsId],
      );
      const expiry = new Date(r.rows[0].expires_at);
      const now = Date.now();
      expect(expiry.getTime() - now).toBeGreaterThan(10 * 60 * 1000);
    } finally {
      c.release();
    }
  });

  dbIt('rotateKey invalidates existing unlocks immediately', async () => {
    await attemptUnlock(adminId, wsId, knownKey);
    expect(await isUnlocked(adminId, wsId)).toBe(true);
    const { plaintext: newKey } = await rotateKey(wsId, adminId);
    expect(await isUnlocked(adminId, wsId)).toBe(false);
    const r = await attemptUnlock(adminId, wsId, knownKey);
    expect(r.kind).toBe('invalid_key');
    const r2 = await attemptUnlock(adminId, wsId, newKey);
    expect(r2.kind).toBe('unlocked');
  });
});
