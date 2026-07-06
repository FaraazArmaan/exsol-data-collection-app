import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-procurement';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedProcurementData } from './_helpers';

describe('GET /api/supply-chain-procurement', () => {
  it('returns only ordered POs with computed totals', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    await seedProcurementData(ctx.clientId); // 1 ordered (10@5000=50000c) + 1 received

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-procurement'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.openPos.length).toBe(1);
    expect(body.openPos[0].status).toBe('ordered');
    expect(body.openPos[0].itemCount).toBe(1);
    expect(body.openPos[0].totalCents).toBe(50000);
    expect(body.openPos[0].expectedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.kpis.openPoCount).toBe(1);
    expect(body.kpis.openValueCents).toBe(50000);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-procurement'));
    expect(res.status).toBe(403);
  });
});
