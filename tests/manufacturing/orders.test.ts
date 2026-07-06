// tests/manufacturing/orders.test.ts
import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/manufacturing-orders';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient, seedBom } from './_helpers';

const createOrder = (ctx: any, body: unknown) =>
  ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/orders', body));
const listOrders = (ctx: any) => ordersHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/orders'));

describe('manufacturing production orders', () => {
  it('creates a planned order and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const bomId = await seedBom(ctx, out!, [{ productId: c1!, qty: 2 }]);
    const res = await createOrder(ctx, { bom_id: bomId, qty: 3 });
    expect(res.status).toBe(201);
    const { id, status } = await res.json();
    expect(status).toBe('planned');
    const listed = await (await listOrders(ctx)).json();
    const row = listed.items.find((i: any) => i.id === id);
    expect(row.qty).toBe(3);
    expect(row.output_product_name).toBe('Kit');
  });

  it('400 qty_required for non-positive qty', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const bomId = await seedBom(ctx, out!, [{ productId: c1!, qty: 1 }]);
    const res = await createOrder(ctx, { bom_id: bomId, qty: 0 });
    expect(res.status).toBe(400);
  });

  it('404 bom_not_found for a foreign bom', async () => {
    const ctx = await seedManufacturingClient();
    const res = await createOrder(ctx, { bom_id: '00000000-0000-0000-0000-000000000000', qty: 1 });
    expect(res.status).toBe(404);
  });

  it('404 bom_not_found for a malformed bom_id (UUID guard)', async () => {
    const ctx = await seedManufacturingClient();
    const res = await createOrder(ctx, { bom_id: 'not-a-uuid', qty: 1 });
    expect(res.status).toBe(404);
  });
});
