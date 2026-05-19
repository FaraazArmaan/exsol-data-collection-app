import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withAdminContext, withTenantContext } from '../src/lib/tenancy.ts';
import { pool, shutdown } from '../src/lib/db.ts';

const hasTestDb = !!process.env.TEST_DATABASE_URL;
const dbIt = hasTestDb ? it : it.skip;

const wsA = '11111111-1111-1111-1111-111111111111';
const wsB = '22222222-2222-2222-2222-222222222222';
const userA = '11111111-aaaa-1111-1111-111111111111';
const userB = '22222222-aaaa-2222-2222-222222222222';
const adminUser = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function reset() {
  const c = await pool().connect();
  try {
    await c.query(`DELETE FROM stock_movements WHERE workspace_id IN ($1, $2)`, [wsA, wsB]);
    await c.query(`DELETE FROM products WHERE workspace_id IN ($1, $2)`, [wsA, wsB]);
    await c.query(`DELETE FROM workspace_memberships WHERE workspace_id IN ($1, $2)`, [wsA, wsB]);
    await c.query(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [wsA, wsB]);
    await c.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [userA, userB, adminUser]);

    await c.query(
      `INSERT INTO users (id, email, name, is_admin)
       VALUES ($1, 'a@test.local', 'A', false),
              ($2, 'b@test.local', 'B', false),
              ($3, 'admin@test.local', 'Admin', true)`,
      [userA, userB, adminUser],
    );
    await c.query(
      `INSERT INTO workspaces (id, name, primary_user_id, admin_access_key_hash)
       VALUES ($1, 'Workspace A', $3, 'placeholder-hash-a'),
              ($2, 'Workspace B', $4, 'placeholder-hash-b')`,
      [wsA, wsB, userA, userB],
    );
    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role)
       VALUES ($1, $3, 'primary'), ($2, $4, 'primary')`,
      [userA, userB, wsA, wsB],
    );
    await c.query(
      `INSERT INTO products (workspace_id, sku, name, price)
       VALUES ($1, 'A1', 'A-thing', 10),
              ($2, 'B1', 'B-thing', 20)`,
      [wsA, wsB],
    );
  } finally {
    c.release();
  }
}

describe('tenancyContext (requires TEST_DATABASE_URL)', () => {
  beforeAll(async () => {
    if (!hasTestDb) return;
    await reset();
  });

  afterAll(async () => {
    if (hasTestDb) await shutdown();
  });

  dbIt('a user in workspace A sees only A products', async () => {
    const rows = await withTenantContext(
      { userId: userA, workspaceId: wsA },
      async (c) => (await c.query('SELECT sku FROM products ORDER BY sku')).rows,
    );
    expect(rows.map((r) => r.sku)).toEqual(['A1']);
  });

  dbIt('a user in workspace B sees only B products', async () => {
    const rows = await withTenantContext(
      { userId: userB, workspaceId: wsB },
      async (c) => (await c.query('SELECT sku FROM products ORDER BY sku')).rows,
    );
    expect(rows.map((r) => r.sku)).toEqual(['B1']);
  });

  dbIt('writing in workspace A cannot create rows tagged for B', async () => {
    await expect(
      withTenantContext({ userId: userA, workspaceId: wsA }, async (c) =>
        c.query(
          `INSERT INTO products (workspace_id, sku, name, price)
           VALUES ($1, 'X1', 'X', 1)`,
          [wsB],
        ),
      ),
    ).rejects.toThrow();
  });

  dbIt('admin context sees products across all workspaces', async () => {
    const rows = await withAdminContext({ userId: adminUser }, async (c) =>
      (await c.query('SELECT sku FROM products ORDER BY sku')).rows,
    );
    expect(rows.map((r) => r.sku)).toEqual(['A1', 'B1']);
  });

  dbIt('GUCs are transaction-local: a raw connection has no workspace context', async () => {
    await withTenantContext({ userId: userA, workspaceId: wsA }, async () => {});
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT sku FROM products');
      await c.query('ROLLBACK');
      expect(r.rows.length).toBe(0);
    } finally {
      c.release();
    }
  });

  dbIt('a tenant context cannot SELECT from another workspace by adding WHERE', async () => {
    const rows = await withTenantContext(
      { userId: userA, workspaceId: wsA },
      async (c) =>
        (await c.query(`SELECT sku FROM products WHERE workspace_id = $1`, [wsB])).rows,
    );
    expect(rows).toEqual([]);
  });
});
