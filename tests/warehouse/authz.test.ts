import { describe, it, expect } from 'vitest';
import locationsHandler from '../../netlify/functions/warehouse-locations';
import {
  seedClientWithProductsEnabled, makeBucketUserRequest, seedSubordinateUser,
} from '../pos/_helpers';
import { seedWarehouseClient } from './_helpers';

// requireWarehouse is exercised through warehouse-locations GET (the simplest read).
describe('warehouse authz', () => {
  it('401 when unauthenticated', async () => {
    const res = await locationsHandler(new Request('http://localhost/api/warehouse/locations'));
    expect(res.status).toBe(401);
  });

  it('412 when the warehouse product is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await locationsHandler(makeBucketUserRequest(ctx, 'GET', '/api/warehouse/locations'));
    expect(res.status).toBe(412);
  });

  it('200 for L1 Owner without any explicit grant (owner bypass)', async () => {
    const ctx = await seedWarehouseClient();
    const res = await locationsHandler(makeBucketUserRequest(ctx, 'GET', '/api/warehouse/locations'));
    expect(res.status).toBe(200);
  });

  it('403 for an L2 subordinate lacking warehouse.business.view', async () => {
    const ctx = await seedWarehouseClient();
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await locationsHandler(makeBucketUserRequest(sub, 'GET', '/api/warehouse/locations'));
    expect(res.status).toBe(403);
  });

  it('200 for an L2 subordinate granted warehouse.business.view', async () => {
    const ctx = await seedWarehouseClient();
    const sub = await seedSubordinateUser(ctx, 2, ['warehouse.business.view']);
    const res = await locationsHandler(makeBucketUserRequest(sub, 'GET', '/api/warehouse/locations'));
    expect(res.status).toBe(200);
  });
});
