import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/procurement-orders';
import transitionHandler from '../../netlify/functions/procurement-order-transition';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import {
  seedProcurementClient, seedSupplier, readStock, readPurchaseMovements,
} from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedProcurementClient>>;

async function createPO(ctx: Ctx, supplierId: string, productId: string, qty: number): Promise<string> {
  const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
    supplier_id: supplierId, items: [{ product_id: productId, qty, unit_cost_cents: 500 }],
  }));
  return (await res.json()).id as string;
}

const transition = (ctx: Ctx, poId: string, action: string) =>
  transitionHandler(makeBucketUserRequest(ctx, 'POST', `/api/procurement/orders/${poId}/transition`, { action }));

describe('PO FSM + receive → inventory', () => {
  it('receiving increments inventory_stock and writes a purchase movement', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const poId = await createPO(ctx, sup, p, 12);

    expect(await readStock(ctx, p)).toBeNull(); // no stock row yet

    const res = await transition(ctx, poId, 'receive');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('received');

    expect(await readStock(ctx, p)).toBe(12);
    const mv = await readPurchaseMovements(ctx, p);
    expect(mv[0]!.qty_delta).toBe(12);
    expect(mv[0]!.type).toBe('purchase');
    expect(mv[0]!.ref).toBe(`po:${poId}`);
  });

  it('receiving a second PO adds to existing stock', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await transition(ctx, await createPO(ctx, sup, p, 5), 'receive');
    await transition(ctx, await createPO(ctx, sup, p, 8), 'receive');
    expect(await readStock(ctx, p)).toBe(13);
  });

  it('409 receiving an already-received PO', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const poId = await createPO(ctx, sup, p, 3);
    await transition(ctx, poId, 'receive');
    const again = await transition(ctx, poId, 'receive');
    expect(again.status).toBe(409);
  });

  it('draft → order → cancel walks the FSM', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const poId = await createPO(ctx, sup, p, 3);
    expect((await (await transition(ctx, poId, 'order')).json()).status).toBe('ordered');
    expect((await (await transition(ctx, poId, 'cancel')).json()).status).toBe('cancelled');
  });

  it('400 invalid_action for an unknown action', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const poId = await createPO(ctx, sup, p, 3);
    const res = await transition(ctx, poId, 'teleport');
    expect(res.status).toBe(400);
  });
});
