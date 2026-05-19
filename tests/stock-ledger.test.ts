import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { currentCount, recordMovement, recountToAbsolute } from '../src/lib/stock-ledger.ts';
import { pool, shutdown } from '../src/lib/db.ts';
import type { ActorContext } from '../src/lib/types.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '66666666-6666-6666-6666-666666666666';
const userId = '66666666-aaaa-aaaa-aaaa-666666666666';
let productId: string;

const actor = (workspaceId: string): ActorContext => ({
  realActorId: userId,
  realRole: null,
  onBehalfOfId: null,
  workspaceRole: 'primary',
  workspaceId,
  isImpersonating: false,
  impersonationReason: null,
});

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM stock_movements WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM products WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await c.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'ledger@test', 'L')`,
      [userId],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Ledger WS', $2, 'h')`,
      [wsId, userId],
    );
    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, 'primary', now())`,
      [userId, wsId],
    );
    const pr = await c.query(
      `INSERT INTO products (workspace_id, sku, name, price, stock_count)
       VALUES ($1, 'LEDG-01', 'Ledger Test Product', 100, 0)
       RETURNING id`,
      [wsId],
    );
    productId = pr.rows[0].id as string;
  } finally {
    c.release();
  }
}

describe('stockLedger (requires TEST_DATABASE_URL)', () => {
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

  dbIt('recordMovement updates stock_count via trigger', async () => {
    const r = await recordMovement(actor(wsId), {
      productId,
      delta: 20,
      reason: 'purchase',
      source: 'manual',
    });
    expect('error' in r).toBe(false);
    expect(await currentCount(userId, wsId, productId)).toBe(20);
  });

  dbIt('sum-of-deltas equals current count under any permutation', async () => {
    const deltas = [+50, -3, +12, -5, -7, +20, -10, +1, -8];
    const expected = deltas.reduce((a, b) => a + b, 0);
    const shuffled = [...deltas].sort(() => Math.random() - 0.5);
    for (const d of shuffled) {
      await recordMovement(actor(wsId), {
        productId,
        delta: d,
        reason: d > 0 ? 'purchase' : 'sale',
        source: 'manual',
      });
    }
    expect(await currentCount(userId, wsId, productId)).toBe(expected);
  });

  dbIt('rejects zero delta', async () => {
    const r = await recordMovement(actor(wsId), {
      productId,
      delta: 0,
      reason: 'manual_adjust',
      source: 'manual',
    });
    expect(r).toEqual({ error: 'zero_delta' });
  });

  dbIt('rejects non-integer delta', async () => {
    const r = await recordMovement(actor(wsId), {
      productId,
      delta: 1.5 as unknown as number,
      reason: 'purchase',
      source: 'manual',
    });
    expect(r).toEqual({ error: 'non_integer_delta' });
  });

  dbIt('rejects invalid reason and source', async () => {
    const r1 = await recordMovement(actor(wsId), {
      productId,
      delta: 1,
      reason: 'made_up' as never,
      source: 'manual',
    });
    expect(r1).toEqual({ error: 'invalid_reason' });
    const r2 = await recordMovement(actor(wsId), {
      productId,
      delta: 1,
      reason: 'purchase',
      source: 'invented' as never,
    });
    expect(r2).toEqual({ error: 'invalid_source' });
  });

  dbIt('rejects movement on unknown product', async () => {
    const r = await recordMovement(actor(wsId), {
      productId: '00000000-0000-0000-0000-000000000000',
      delta: 1,
      reason: 'purchase',
      source: 'manual',
    });
    expect(r).toEqual({ error: 'product_not_found' });
  });

  dbIt('recountToAbsolute records the delta needed to reach the target', async () => {
    await recordMovement(actor(wsId), {
      productId, delta: 47, reason: 'purchase', source: 'manual',
    });
    const r = await recountToAbsolute(actor(wsId), productId, 50);
    expect(r.kind).toBe('recorded');
    if (r.kind === 'recorded') expect(r.movement.delta).toBe(3);
    expect(await currentCount(userId, wsId, productId)).toBe(50);
  });

  dbIt('recountToAbsolute is a no-op when count matches', async () => {
    await recordMovement(actor(wsId), {
      productId, delta: 10, reason: 'purchase', source: 'manual',
    });
    const r = await recountToAbsolute(actor(wsId), productId, 10);
    expect(r.kind).toBe('no_change');
    expect(await currentCount(userId, wsId, productId)).toBe(10);
  });

  dbIt('writes an audit event for each movement', async () => {
    await recordMovement(actor(wsId), {
      productId, delta: 5, reason: 'purchase', source: 'manual',
    });
    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const r = await c.query(
        `SELECT action FROM audit_events WHERE workspace_id = $1`,
        [wsId],
      );
      await c.query(`COMMIT`);
      const actions = r.rows.map((row: any) => row.action);
      expect(actions).toContain('stock.movement');
    } finally {
      c.release();
    }
  });
});
