import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/procurement-orders';
import transitionHandler from '../../netlify/functions/procurement-order-transition';
import settingsHandler from '../../netlify/functions/procurement-settings';
import { seedProcurementClient, seedSupplier } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

type Ctx = Awaited<ReturnType<typeof seedProcurementClient>>;

async function createPO(ctx: Ctx, supplierId: string, productId: string, qty: number, unitCost: number): Promise<string> {
  const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
    supplier_id: supplierId, items: [{ product_id: productId, qty, unit_cost_cents: unitCost }],
  }));
  return (await res.json()).id as string;
}
const transition = (ctx: Ctx, poId: string, action: string) =>
  transitionHandler(makeBucketUserRequest(ctx, 'POST', `/api/procurement/orders/${poId}/transition`, { action }));
const setThreshold = (ctx: Ctx, cents: number) =>
  settingsHandler(makeBucketUserRequest(ctx, 'PATCH', '/api/procurement/settings', { po_approval_threshold_cents: cents }));

describe('procurement vendor approvals', () => {
  it('settings default 0 + PATCH persists', async () => {
    const ctx = await seedProcurementClient();
    const g = await (await settingsHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/settings'))).json();
    expect(g.po_approval_threshold_cents).toBe(0);
    const p = await (await setThreshold(ctx, 100000)).json();
    expect(p.po_approval_threshold_cents).toBe(100000);
  });

  it('a PO under the threshold orders directly', async () => {
    const ctx = await seedProcurementClient();
    await setThreshold(ctx, 100000);
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 1, 5000); // 5000 < 100000
    expect((await (await transition(ctx, po, 'order')).json()).status).toBe('ordered');
  });

  it('a PO over the threshold routes to pending_approval; approve → ordered', async () => {
    const ctx = await seedProcurementClient();
    await setThreshold(ctx, 100000);
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 30, 5000); // 150000 >= 100000
    expect((await (await transition(ctx, po, 'order')).json()).status).toBe('pending_approval');
    expect((await (await transition(ctx, po, 'approve')).json()).status).toBe('ordered');
  });

  it('reject sends a pending PO back to draft', async () => {
    const ctx = await seedProcurementClient();
    await setThreshold(ctx, 100000);
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 30, 5000);
    await transition(ctx, po, 'order');
    expect((await (await transition(ctx, po, 'reject')).json()).status).toBe('draft');
  });

  it('409 approving a draft PO', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 1, 100);
    expect((await transition(ctx, po, 'approve')).status).toBe(409);
  });
});
