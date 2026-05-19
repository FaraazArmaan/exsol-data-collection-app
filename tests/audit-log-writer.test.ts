import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { record } from '../src/lib/audit-log-writer.ts';
import { pool, shutdown } from '../src/lib/db.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsId = '33333333-3333-3333-3333-333333333333';
const adminId = '33333333-aaaa-aaaa-aaaa-333333333333';
const targetId = '33333333-bbbb-bbbb-bbbb-333333333333';

async function setup() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE workspace_id = $1`, [wsId]);
    await c.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await c.query(`DELETE FROM users WHERE id IN ($1, $2)`, [adminId, targetId]);

    await c.query(
      `INSERT INTO users (id, email, name, is_admin) VALUES
       ($1, 'admin@audit.test', 'Admin', true),
       ($2, 'target@audit.test', 'Target', false)`,
      [adminId, targetId],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Audit WS', $2, 'placeholder')`,
      [wsId, adminId],
    );
  } finally {
    c.release();
  }
}

async function clearEvents() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM audit_events WHERE actor_user_id IN ($1, $2)`, [adminId, targetId]);
  } finally {
    c.release();
  }
}

async function readEvents() {
  const c = await pool().connect();
  try {
    await c.query(`BEGIN`);
    await c.query(`SELECT set_config('app.is_admin', 'true', true)`);
    const r = await c.query(
      `SELECT * FROM audit_events
       WHERE actor_user_id IN ($1, $2) ORDER BY occurred_at`,
      [adminId, targetId],
    );
    await c.query(`COMMIT`);
    return r.rows;
  } finally {
    c.release();
  }
}

describe('auditLogWriter.record (requires TEST_DATABASE_URL)', () => {
  beforeAll(async () => {
    if (!hasTestDb) return;
    await setup();
  });

  beforeEach(async () => {
    if (!hasTestDb) return;
    await clearEvents();
  });

  afterAll(async () => {
    if (hasTestDb) await shutdown();
  });

  dbIt('records a basic event with action and resource', async () => {
    await record({
      realActorId: adminId,
      workspaceId: wsId,
      action: 'product.create',
      resourceType: 'product',
      resourceId: '99999999-9999-9999-9999-999999999999',
    });
    const rows = await readEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('product.create');
    expect(rows[0].resource_type).toBe('product');
    expect(rows[0].actor_user_id).toBe(adminId);
  });

  dbIt('captures only changed fields in before/after diff', async () => {
    await record({
      realActorId: adminId,
      workspaceId: wsId,
      action: 'product.update',
      resourceType: 'product',
      before: { name: 'Old', price: 100, sku: 'A1' },
      after: { name: 'New', price: 100, sku: 'A1' },
    });
    const rows = await readEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].before_data).toEqual({ name: 'Old' });
    expect(rows[0].after_data).toEqual({ name: 'New' });
  });

  dbIt('omits diff when nothing changed', async () => {
    await record({
      realActorId: adminId,
      workspaceId: wsId,
      action: 'product.touch',
      before: { name: 'Same' },
      after: { name: 'Same' },
    });
    const rows = await readEvents();
    expect(rows[0].before_data).toBeNull();
    expect(rows[0].after_data).toBeNull();
  });

  dbIt('records impersonation attribution when on_behalf_of is set', async () => {
    await record({
      realActorId: adminId,
      onBehalfOfId: targetId,
      impersonationReason: 'Helping fix product',
      workspaceId: wsId,
      action: 'product.update',
      before: { name: 'A' },
      after: { name: 'B' },
    });
    const rows = await readEvents();
    expect(rows[0].actor_user_id).toBe(adminId);
    expect(rows[0].on_behalf_of).toBe(targetId);
    expect(rows[0].impersonation_reason).toBe('Helping fix product');
  });

  dbIt('coalesces bulk operations into a single row with summary', async () => {
    await record({
      realActorId: adminId,
      workspaceId: wsId,
      action: 'product.bulk_import',
      bulkSummary: { count: 1247, sampleIds: ['a', 'b', 'c'] },
    });
    const rows = await readEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.bulkSummary).toEqual({
      count: 1247,
      sampleIds: ['a', 'b', 'c'],
    });
  });
});
