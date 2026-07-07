import { describe, it, expect } from 'vitest';
import lotsHandler from '../../netlify/functions/manufacturing-lots';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;
const byOrder = (ctx: Ctx, orderId: string) => lotsHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/lots?order_id=${orderId}`));
const byLot = (ctx: Ctx, lotRef: string) => lotsHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/lots?lot_ref=${encodeURIComponent(lotRef)}`));
const record = (ctx: Ctx, body: unknown) => lotsHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/lots', body));

async function seedOrderWithComponent(ctx: Ctx): Promise<{ orderId: string; componentId: string }> {
  const [out, comp] = await seedProducts(ctx.clientId, [{ name: 'Out' }, { name: 'Comp' }]);
  const bom = await seedBom(ctx, out!, [{ productId: comp!, qty: 2 }]);
  const orderId = await seedOrder(ctx, bom, 5, 'in_progress');
  return { orderId, componentId: comp! };
}

describe('manufacturing part tracking', () => {
  it('records a consumption lot and lists it by order', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, componentId } = await seedOrderWithComponent(ctx);
    const res = await record(ctx, { production_order_id: orderId, component_product_id: componentId, lot_ref: 'LOT-A1', qty: 10 });
    expect(res.status).toBe(201);
    const lots = (await (await byOrder(ctx, orderId)).json()).lots as Array<{ lot_ref: string; qty: number; component_product_id: string }>;
    expect(lots.some((l) => l.lot_ref === 'LOT-A1' && l.qty === 10 && l.component_product_id === componentId)).toBe(true);
  });

  it('traces a lot forward to the orders that consumed it', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, componentId } = await seedOrderWithComponent(ctx);
    const ref = `LOT-${Math.random().toString(36).slice(2, 8)}`;
    await record(ctx, { production_order_id: orderId, component_product_id: componentId, lot_ref: ref, qty: 4 });
    const lots = (await (await byLot(ctx, ref)).json()).lots as Array<{ production_order_id: string; output_product_name: string }>;
    expect(lots.some((l) => l.production_order_id === orderId && typeof l.output_product_name === 'string')).toBe(true);
  });

  it('400 when neither order_id nor lot_ref is given', async () => {
    const ctx = await seedManufacturingClient();
    const res = await lotsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/lots'));
    expect(res.status).toBe(400);
  });

  it('validates: lot_ref required, qty positive', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, componentId } = await seedOrderWithComponent(ctx);
    expect((await record(ctx, { production_order_id: orderId, component_product_id: componentId, lot_ref: '  ', qty: 1 })).status).toBe(400);
    expect((await record(ctx, { production_order_id: orderId, component_product_id: componentId, lot_ref: 'X', qty: 0 })).status).toBe(400);
  });

  it('404 for a foreign-client order or component', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const { orderId, componentId } = await seedOrderWithComponent(ctx);
    const { orderId: foreignOrder } = await seedOrderWithComponent(other);
    expect((await record(ctx, { production_order_id: foreignOrder, component_product_id: componentId, lot_ref: 'X', qty: 1 })).status).toBe(404);
    const [foreignComp] = await seedProducts(other.clientId, [{ name: 'FC' }]);
    expect((await record(ctx, { production_order_id: orderId, component_product_id: foreignComp!, lot_ref: 'X', qty: 1 })).status).toBe(404);
  });

  it('412 not enabled; 403 for L2 without edit', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await byOrder(bare, '00000000-0000-0000-0000-000000000000')).status).toBe(412);
    const ctx = await seedManufacturingClient();
    const { orderId, componentId } = await seedOrderWithComponent(ctx);
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.view']);
    expect((await record(viewer, { production_order_id: orderId, component_product_id: componentId, lot_ref: 'X', qty: 1 })).status).toBe(403);
  });
});
