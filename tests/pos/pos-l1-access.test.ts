// L1 (Primary/Owner) POS access — the Owner is treated as all-on, exactly
// like requirePermission and every other gate in the app. The enable-gate
// (products + pos) still applies; only the surface-level permission-key check
// is bypassed for L1. Non-Owners (L2+) still need explicit pos.* grants.

import { describe, it, expect } from 'vitest';
import { POS_ACTIONS } from '../../src/modules/registry/types';
import { requirePos } from '../../netlify/functions/_pos-authz';
import {
  seedClientWithProductsEnabled,
  seedSubordinateUser,
  disableProductsForClient,
  grantPerms,
  makeBucketUserRequest,
} from './_helpers';

const ALL_POS_KEYS = POS_ACTIONS.map((a) => `pos.${a}`);

describe('requirePos — L1 Owner bypass', () => {
  it('grants an L1 Owner the FULL pos.* action set even with an empty matrix', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []); // empty — the default fresh-workspace state

    const req = makeBucketUserRequest(ctx, 'GET', '/api/pos/menu');
    const r = await requirePos(req, ['pos.menu.view']);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Owner must hold every action — so downstream viewAll scoping and the
    // FSM (markPaid/fulfill/refund) treat them as fully privileged.
    for (const key of ALL_POS_KEYS) {
      expect(r.ctx.perms.has(key)).toBe(true);
    }
  });

  it('still enforces the enable-gate for L1 (products disabled → 412)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await disableProductsForClient(ctx.clientId);
    await grantPerms(ctx.clientId, 1, []);

    const r = await requirePos(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'), ['pos.menu.view']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(412);
  });

  it('does NOT bypass for a non-Owner (L2 with empty matrix → 403)', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []); // no pos.* grants

    const r = await requirePos(makeBucketUserRequest(sub, 'GET', '/api/pos/menu'), ['pos.menu.view']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(403);
  });

  it('honors explicit grants for a non-Owner (L2 with pos.menu.view → ok)', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, ['pos.menu.view']);

    const r = await requirePos(makeBucketUserRequest(sub, 'GET', '/api/pos/menu'), ['pos.menu.view']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only the granted key — no implicit viewAll for a subordinate.
    expect(r.ctx.perms.has('pos.menu.view')).toBe(true);
    expect(r.ctx.perms.has('pos.history.viewAll')).toBe(false);
  });
});
