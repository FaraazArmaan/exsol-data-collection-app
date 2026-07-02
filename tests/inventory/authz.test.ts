import { describe, it, expect } from 'vitest';
import listHandler from '../../netlify/functions/inventory-list';
import {
  seedClientWithProductsEnabled, makeBucketUserRequest, seedSubordinateUser,
} from '../pos/_helpers';
import { seedInventoryClient } from './_helpers';

// requireInventory is exercised through inventory-list (the simplest GET).
describe('inventory authz', () => {
  it('401 when unauthenticated', async () => {
    const res = await listHandler(new Request('http://localhost/api/inventory/list'));
    expect(res.status).toBe(401);
  });

  it('412 when the inventory product is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(412);
  });

  it('200 for L1 Owner without any explicit grant (owner bypass)', async () => {
    const ctx = await seedInventoryClient();
    const res = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(200);
  });

  it('403 for an L2 subordinate lacking inventory.products.view', async () => {
    const ctx = await seedInventoryClient();
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await listHandler(makeBucketUserRequest(sub, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(403);
  });

  it('200 for an L2 subordinate granted inventory.products.view', async () => {
    const ctx = await seedInventoryClient();
    const sub = await seedSubordinateUser(ctx, 2, ['inventory.products.view']);
    const res = await listHandler(makeBucketUserRequest(sub, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(200);
  });
});
