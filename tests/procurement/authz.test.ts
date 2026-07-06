import { describe, it, expect } from 'vitest';
import suppliersHandler from '../../netlify/functions/procurement-suppliers';
import { seedClientWithProductsEnabled, makeBucketUserRequest, seedSubordinateUser } from '../pos/_helpers';
import { seedProcurementClient } from './_helpers';

// requireProcurement is exercised through the suppliers GET (simplest read).
describe('procurement authz', () => {
  it('401 when unauthenticated', async () => {
    const res = await suppliersHandler(new Request('http://localhost/api/procurement/suppliers'));
    expect(res.status).toBe(401);
  });

  it('412 when the procurement product is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await suppliersHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/suppliers'));
    expect(res.status).toBe(412);
  });

  it('200 for L1 Owner without any explicit grant (owner bypass)', async () => {
    const ctx = await seedProcurementClient();
    const res = await suppliersHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/suppliers'));
    expect(res.status).toBe(200);
  });

  it('403 for an L2 subordinate lacking procurement.products.view', async () => {
    const ctx = await seedProcurementClient();
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await suppliersHandler(makeBucketUserRequest(sub, 'GET', '/api/procurement/suppliers'));
    expect(res.status).toBe(403);
  });

  it('200 for an L2 subordinate granted procurement.products.view', async () => {
    const ctx = await seedProcurementClient();
    const sub = await seedSubordinateUser(ctx, 2, ['procurement.products.view']);
    const res = await suppliersHandler(makeBucketUserRequest(sub, 'GET', '/api/procurement/suppliers'));
    expect(res.status).toBe(200);
  });
});
