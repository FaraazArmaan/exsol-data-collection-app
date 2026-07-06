import { describe, it, expect } from 'vitest';
import { resolveSupplyChainAccess } from '../../netlify/functions/_supply-chain-authz';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

describe('resolveSupplyChainAccess', () => {
  it('owner (L1) is allowed and gets their clientId', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []); // L1 owner bypasses the matrix
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.access.clientId).toBe(ctx.clientId);
  });

  it('a sub holding supply-chain.products.view is allowed', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, ['supply-chain.products.view']);
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(true);
  });

  it('a sub without the key is 403', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.res.status).toBe(403);
  });

  it('no session is 401', async () => {
    const out = await resolveSupplyChainAccess(new Request('http://localhost/api/supply-chain-inventory'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.res.status).toBe(401);
  });
});
