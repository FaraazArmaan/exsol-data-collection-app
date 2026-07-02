import { describe, it, expect } from 'vitest';
import movementsHandler from '../../netlify/functions/inventory-movements';
import adjustHandler from '../../netlify/functions/inventory-adjust';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedInventoryClient, seedStock } from './_helpers';

describe('GET /api/inventory/movements', () => {
  it('400 when product_id is missing', async () => {
    const ctx = await seedInventoryClient();
    const res = await movementsHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/movements'));
    expect(res.status).toBe(400);
  });

  it('returns movements newest-first after an adjustment', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10);
    await adjustHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/inventory/adjust', {
        product_id: p, qty_delta: -2, reason: 'sold offline',
      }),
    );
    const res = await movementsHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/inventory/movements?product_id=${p}`),
    );
    expect(res.status).toBe(200);
    const { movements } = await res.json();
    expect(movements.length).toBeGreaterThanOrEqual(1);
    expect(movements[0].type).toBe('adjustment');
    expect(movements[0].qty_delta).toBe(-2);
    expect(movements[0].ref).toBe('sold offline');
  });
});
