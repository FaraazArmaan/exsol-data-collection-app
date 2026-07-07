import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import qcHandler from '../../netlify/functions/manufacturing-qc';
import qcResultHandler from '../../netlify/functions/manufacturing-qc-result';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder, seedStock } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);
type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;

const listQc = (ctx: Ctx, orderId: string) => qcHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/qc?order_id=${orderId}`));
const addQc = (ctx: Ctx, body: unknown) => qcHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/qc', body));
const recordQc = (ctx: Ctx, body: unknown) => qcResultHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/qc-result', body));

async function seedOrderWithOutputStock(ctx: Ctx, outStock = 20): Promise<{ orderId: string; outputId: string }> {
  const [out, comp] = await seedProducts(ctx.clientId, [{ name: 'Out' }, { name: 'Comp' }]);
  const bom = await seedBom(ctx, out!, [{ productId: comp!, qty: 1 }]);
  const orderId = await seedOrder(ctx, bom, 5, 'done');
  await seedStock(ctx, out!, outStock);
  return { orderId, outputId: out! };
}
const readStock = async (ctx: Ctx, productId: string) =>
  Number(((await sql`SELECT qty_on_hand FROM public.inventory_stock WHERE client_id = ${ctx.clientId} AND product_id = ${productId} LIMIT 1`) as Array<{ qty_on_hand: number }>)[0]?.qty_on_hand ?? 0);

describe('manufacturing quality control', () => {
  it('adds a QC item and lists it for the order', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId } = await seedOrderWithOutputStock(ctx);
    const res = await addQc(ctx, { production_order_id: orderId, item: 'Surface finish' });
    expect(res.status).toBe(201);
    const items = (await (await listQc(ctx, orderId)).json()).checks as Array<{ id: string; item: string; result: string }>;
    expect(items.some((i) => i.item === 'Surface finish' && i.result === 'pending')).toBe(true);
  });

  it('records a pass', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId } = await seedOrderWithOutputStock(ctx);
    const id = (await (await addQc(ctx, { production_order_id: orderId, item: 'Dimensions' })).json()).check.id;
    const res = await recordQc(ctx, { id, result: 'pass' });
    expect(res.status).toBe(200);
    expect((await res.json()).check.result).toBe('pass');
  });

  it('fail + scrap decrements output stock and writes an adjustment movement', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, outputId } = await seedOrderWithOutputStock(ctx, 20);
    const id = (await (await addQc(ctx, { production_order_id: orderId, item: 'Leak test' })).json()).check.id;
    const res = await recordQc(ctx, { id, result: 'fail', disposition: 'scrap', scrap_qty: 3 });
    expect(res.status).toBe(200);
    expect(await readStock(ctx, outputId)).toBe(17);
    const mv = (await sql`SELECT qty_delta, type, ref FROM public.stock_movements WHERE client_id = ${ctx.clientId} AND product_id = ${outputId} AND ref LIKE 'qc-scrap%'`) as Array<{ qty_delta: number }>;
    expect(mv.some((m) => Number(m.qty_delta) === -3)).toBe(true);
  });

  it('fail + scrap beyond available stock is rejected (400), stock unchanged', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, outputId } = await seedOrderWithOutputStock(ctx, 2);
    const id = (await (await addQc(ctx, { production_order_id: orderId, item: 'X' })).json()).check.id;
    const res = await recordQc(ctx, { id, result: 'fail', disposition: 'scrap', scrap_qty: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('insufficient_stock');
    expect(await readStock(ctx, outputId)).toBe(2);
  });

  it('fail + rework records without touching stock', async () => {
    const ctx = await seedManufacturingClient();
    const { orderId, outputId } = await seedOrderWithOutputStock(ctx, 10);
    const id = (await (await addQc(ctx, { production_order_id: orderId, item: 'Weld' })).json()).check.id;
    const res = await recordQc(ctx, { id, result: 'fail', disposition: 'rework' });
    expect(res.status).toBe(200);
    expect((await res.json()).check.disposition).toBe('rework');
    expect(await readStock(ctx, outputId)).toBe(10);
  });

  it('404 adding QC to a foreign-client order; 404 recording a foreign check', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const { orderId } = await seedOrderWithOutputStock(other);
    expect((await addQc(ctx, { production_order_id: orderId, item: 'X' })).status).toBe(404);
    const foreignId = (await (await addQc(other, { production_order_id: orderId, item: 'Y' })).json()).check.id;
    expect((await recordQc(ctx, { id: foreignId, result: 'pass' })).status).toBe(404);
  });

  it('412 not enabled; 403 for L2 without edit', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await addQc(bare, { production_order_id: '00000000-0000-0000-0000-000000000000', item: 'X' })).status).toBe(412);
    const ctx = await seedManufacturingClient();
    const { orderId } = await seedOrderWithOutputStock(ctx);
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.view']);
    expect((await addQc(viewer, { production_order_id: orderId, item: 'X' })).status).toBe(403);
  });
});
