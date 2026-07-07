import { describe, it, expect } from 'vitest';
import costsHandler from '../../netlify/functions/manufacturing-costs';
import bomCostHandler from '../../netlify/functions/manufacturing-bom-cost';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedBom } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;
const listCosts = (ctx: Ctx) => costsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/costs'));
const setCost = (ctx: Ctx, body: unknown) => costsHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/costs', body));
const bomCost = (ctx: Ctx, id: string) => bomCostHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/bom-cost/${id}`));

describe('manufacturing BOM cost', () => {
  it('sets a product unit cost and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const [p] = await seedProducts(ctx.clientId, [{ name: 'Widget' }]);
    const res = await setCost(ctx, { product_id: p, unit_cost_cents: 350 });
    expect(res.status).toBe(200);
    const costs = (await (await listCosts(ctx)).json()).costs as Array<{ product_id: string; unit_cost_cents: number }>;
    const found = costs.find((c) => c.product_id === p);
    expect(found?.unit_cost_cents).toBe(350); // numeric on the wire, not "350"
    expect(typeof found?.unit_cost_cents).toBe('number');
  });

  it('400 for a negative cost', async () => {
    const ctx = await seedManufacturingClient();
    const [p] = await seedProducts(ctx.clientId, [{ name: 'W' }]);
    const res = await setCost(ctx, { product_id: p, unit_cost_cents: -5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('cost_invalid');
  });

  it('404 setting cost for a foreign-client product', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const [foreign] = await seedProducts(other.clientId, [{ name: 'F' }]);
    const res = await setCost(ctx, { product_id: foreign, unit_cost_cents: 100 });
    expect(res.status).toBe(404);
  });

  it('rolls up BOM cost from component unit costs', async () => {
    const ctx = await seedManufacturingClient();
    const [out, a, b] = await seedProducts(ctx.clientId, [{ name: 'Out' }, { name: 'A' }, { name: 'B' }]);
    await setCost(ctx, { product_id: a, unit_cost_cents: 200 });
    await setCost(ctx, { product_id: b, unit_cost_cents: 150 });
    const bom = await seedBom(ctx, out!, [{ productId: a!, qty: 2 }, { productId: b!, qty: 3 }]); // 2*200 + 3*150 = 850
    const res = await bomCost(ctx, bom);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.total_cents)).toBe(850);
    expect(body.components).toHaveLength(2);
    // a component with no cost set rolls up as 0
    const [out2, c] = await seedProducts(ctx.clientId, [{ name: 'Out2' }, { name: 'C' }]);
    const bom2 = await seedBom(ctx, out2!, [{ productId: c!, qty: 5 }]);
    expect(Number((await (await bomCost(ctx, bom2)).json()).total_cents)).toBe(0);
  });

  it('404 rollup for a foreign-client BOM', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const [out, a] = await seedProducts(other.clientId, [{ name: 'O' }, { name: 'A' }]);
    const bom = await seedBom(other, out!, [{ productId: a!, qty: 1 }]);
    expect((await bomCost(ctx, bom)).status).toBe(404);
  });

  it('412 not enabled; 403 for L2 without edit on cost set', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await listCosts(bare)).status).toBe(412);
    const ctx = await seedManufacturingClient();
    const [p] = await seedProducts(ctx.clientId, [{ name: 'W' }]);
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.view']);
    expect((await setCost(viewer, { product_id: p, unit_cost_cents: 10 })).status).toBe(403);
  });
});
