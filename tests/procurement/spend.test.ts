import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/procurement-orders';
import transitionHandler from '../../netlify/functions/procurement-order-transition';
import spendHandler from '../../netlify/functions/procurement-spend';
import { seedProcurementClient, seedSupplier } from './_helpers';
import { seedProducts, makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';

type Ctx = Awaited<ReturnType<typeof seedProcurementClient>>;

async function orderedPO(ctx: Ctx, sup: string, prod: string, qty: number, cost: number): Promise<string> {
  const created = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
    supplier_id: sup, items: [{ product_id: prod, qty, unit_cost_cents: cost }],
  }));
  const id = (await created.json()).id as string;
  await transitionHandler(makeBucketUserRequest(ctx, 'POST', `/api/procurement/orders/${id}/transition`, { action: 'order' }));
  return id;
}
const getSpend = (ctx: Ctx) => spendHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/spend'));

interface Bucket { name: string; total_cents: number }

describe('procurement spend analytics', () => {
  it('412 when procurement is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    expect((await spendHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/spend'))).status).toBe(412);
  });

  it('aggregates committed spend by supplier, category and month', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'Acme');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await orderedPO(ctx, sup, prod, 10, 500); // 5000

    const s = await (await getSpend(ctx)).json();
    const acme = (s.bySupplier as Bucket[]).find((x) => x.name === 'Acme');
    expect(acme?.total_cents).toBe(5000);
    expect(s.overTime.length).toBeGreaterThanOrEqual(1);
    expect(s.byCategory.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes draft POs from committed spend', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'Acme');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
      supplier_id: sup, items: [{ product_id: prod, qty: 5, unit_cost_cents: 100 }],
    })); // left as draft, never ordered
    const s = await (await getSpend(ctx)).json();
    expect(s.bySupplier.length).toBe(0);
  });
});
