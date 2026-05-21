import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { bulkCreateProducts } from '../src/lib/product-service.ts';
import { pool, shutdown } from '../src/lib/db.ts';
import type { ActorContext } from '../src/lib/types.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '77777777-7777-7777-7777-777777777777';
const userId = '77777777-aaaa-aaaa-aaaa-777777777777';

const actor: ActorContext = {
  realActorId: userId,
  realRole: null,
  onBehalfOfId: null,
  workspaceRole: 'primary',
  workspaceId: wsId,
  isImpersonating: false,
  impersonationReason: null,
};

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
      `INSERT INTO users (id, email, name) VALUES ($1, 'bulk@test', 'B')`,
      [userId],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Bulk WS', $2, 'h')`,
      [wsId, userId],
    );
    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, 'primary', now())`,
      [userId, wsId],
    );
  } finally {
    c.release();
  }
}

describe('bulkCreateProducts (requires TEST_DATABASE_URL)', () => {
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

  dbIt('inserts every valid row and returns them in input order', async () => {
    const result = await bulkCreateProducts(actor, [
      { sku: 'B-001', name: 'Bulk One', price: 10 },
      { sku: 'B-002', name: 'Bulk Two', price: 20 },
      { sku: 'B-003', name: 'Bulk Three', price: 30 },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(3);
    expect(result.created.map((p) => p.sku)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(result.summary).toEqual({ total: 3, succeeded: 3, failed: 0 });
  });

  dbIt('collects per-row errors and still inserts the valid rows', async () => {
    const result = await bulkCreateProducts(actor, [
      { sku: 'OK-1', name: 'Good', price: 10 },
      { sku: '', name: 'Bad SKU', price: 10 },
      { sku: 'OK-2', name: 'Also Good', price: 20 },
      { sku: 'OK-3', name: '', price: 30 },
    ]);
    expect(result.created.map((p) => p.sku).sort()).toEqual(['OK-1', 'OK-2']);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ row: 1, error: 'invalid_input' });
    expect(result.errors[1]).toMatchObject({ row: 3, error: 'invalid_input' });
    expect(result.summary).toEqual({ total: 4, succeeded: 2, failed: 2 });
  });

  dbIt('reports duplicate SKU within the same batch as a per-row error', async () => {
    const result = await bulkCreateProducts(actor, [
      { sku: 'DUP-1', name: 'First', price: 10 },
      { sku: 'DUP-1', name: 'Second with same SKU', price: 15 },
      { sku: 'DUP-2', name: 'Different', price: 20 },
    ]);
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 1, error: 'duplicate_sku' });
    expect(result.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
  });

  dbIt('reports duplicate of pre-existing SKU as a per-row error', async () => {
    await bulkCreateProducts(actor, [{ sku: 'PRE-1', name: 'Existing', price: 5 }]);
    const result = await bulkCreateProducts(actor, [
      { sku: 'PRE-1', name: 'Conflict', price: 10 },
      { sku: 'NEW-1', name: 'New', price: 20 },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 0, error: 'duplicate_sku' });
    expect(result.created.map((p) => p.sku)).toEqual(['NEW-1']);
  });

  dbIt('rejects empty batch with an error result', async () => {
    const result = await bulkCreateProducts(actor, []);
    expect(result.created).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual({ total: 0, succeeded: 0, failed: 0 });
  });

  dbIt('writes audit events for each successfully created product', async () => {
    await bulkCreateProducts(actor, [
      { sku: 'AUD-1', name: 'Audited One', price: 10 },
      { sku: '', name: 'Bad', price: 10 },
      { sku: 'AUD-2', name: 'Audited Two', price: 20 },
    ]);
    const c = await pool().connect();
    try {
      await c.query(`BEGIN`);
      await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
      const r = await c.query(
        `SELECT action, resource_id FROM audit_events WHERE workspace_id = $1 AND action = 'product.create'`,
        [wsId],
      );
      await c.query(`COMMIT`);
      expect(r.rows).toHaveLength(2);
    } finally {
      c.release();
    }
  });
});
