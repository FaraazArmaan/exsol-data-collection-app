// tests/manufacturing/authz.test.ts
import { describe, it, expect } from 'vitest';
import bomsHandler from '../../netlify/functions/manufacturing-boms';
import { seedClientWithProductsEnabled, seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient } from './_helpers';

const listBoms = (ctx: Awaited<ReturnType<typeof seedManufacturingClient>>) =>
  bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));

describe('manufacturing authz', () => {
  it('412 when the manufacturing module is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));
    expect(res.status).toBe(412);
    expect((await res.json()).error.code).toBe('manufacturing_module_not_enabled');
  });

  it('200 for an L1 Owner (all-on bypass) when enabled', async () => {
    const ctx = await seedManufacturingClient();
    const res = await listBoms(ctx);
    expect(res.status).toBe(200);
  });

  it('403 for an L2 user lacking manufacturing.products.view', async () => {
    const base = await seedManufacturingClient();
    const sub = await seedSubordinateUser(base, 2, []); // no keys
    const res = await bomsHandler(makeBucketUserRequest(sub, 'GET', '/api/manufacturing/boms'));
    expect(res.status).toBe(403);
  });
});
