import { describe, it, expect } from 'vitest';
import generateHandler from '../../netlify/functions/onboard-generate';
import { seedClientWithProductsEnabled, makeBucketUserRequest, seedSubordinateUser } from '../pos/_helpers';
import { seedDataCollectionClient } from './_helpers';

// requireDataCollection is exercised through onboard-generate.
describe('onboard-generate authz', () => {
  it('401 when unauthenticated', async () => {
    const res = await generateHandler(new Request('http://localhost/api/onboard-generate', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('412 when the data-collection product is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await generateHandler(makeBucketUserRequest(ctx, 'POST', '/api/onboard-generate', {}));
    expect(res.status).toBe(412);
  });

  it('201 for L1 Owner without any explicit grant (owner bypass)', async () => {
    const ctx = await seedDataCollectionClient();
    const res = await generateHandler(makeBucketUserRequest(ctx, 'POST', '/api/onboard-generate', {}));
    expect(res.status).toBe(201);
    expect((await res.json()).token).toBeTruthy();
  });

  it('403 for an L2 subordinate lacking data-collection.products.create', async () => {
    const ctx = await seedDataCollectionClient();
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await generateHandler(makeBucketUserRequest(sub, 'POST', '/api/onboard-generate', {}));
    expect(res.status).toBe(403);
  });

  it('201 for an L2 subordinate granted data-collection.products.create', async () => {
    const ctx = await seedDataCollectionClient();
    const sub = await seedSubordinateUser(ctx, 2, ['data-collection.products.create']);
    const res = await generateHandler(makeBucketUserRequest(sub, 'POST', '/api/onboard-generate', {}));
    expect(res.status).toBe(201);
  });
});
