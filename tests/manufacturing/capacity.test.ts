import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import resourcesHandler from '../../netlify/functions/manufacturing-resources';
import assignHandler from '../../netlify/functions/manufacturing-order-resource';
import capacityHandler from '../../netlify/functions/manufacturing-capacity';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);
type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;

const listRes = (ctx: Ctx) => resourcesHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/resources'));
const addRes = (ctx: Ctx, body: unknown) => resourcesHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/resources', body));
const assign = (ctx: Ctx, body: unknown) => assignHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/order-resource', body));
const capacity = (ctx: Ctx, qs = '') => capacityHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/capacity${qs}`));

async function seedOrderDueToday(ctx: Ctx): Promise<string> {
  const [out, comp] = await seedProducts(ctx.clientId, [{ name: 'Out' }, { name: 'Comp' }]);
  const bom = await seedBom(ctx, out!, [{ productId: comp!, qty: 1 }]);
  const id = await seedOrder(ctx, bom, 5, 'planned');
  await sql`UPDATE public.production_orders SET due_on = current_date WHERE id = ${id}`;
  return id;
}

describe('manufacturing capacity planning', () => {
  it('creates a resource and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const res = await addRes(ctx, { name: 'Assembly line A', hours_per_day: 8 });
    expect(res.status).toBe(201);
    const list = (await (await listRes(ctx)).json()).resources as Array<{ id: string; name: string; hours_per_day: number }>;
    expect(list.some((r) => r.name === 'Assembly line A' && r.hours_per_day === 8)).toBe(true);
  });

  it('400 name_required / hours_invalid; 409 duplicate name', async () => {
    const ctx = await seedManufacturingClient();
    expect((await addRes(ctx, { name: '  ', hours_per_day: 8 })).status).toBe(400);
    expect((await addRes(ctx, { name: 'X', hours_per_day: 0 })).status).toBe(400);
    const n = `Res-${Math.random().toString(36).slice(2, 7)}`;
    expect((await addRes(ctx, { name: n, hours_per_day: 8 })).status).toBe(201);
    expect((await addRes(ctx, { name: n, hours_per_day: 8 })).status).toBe(409);
  });

  it('assigns a resource + estimated hours to an order', async () => {
    const ctx = await seedManufacturingClient();
    const orderId = await seedOrderDueToday(ctx);
    const rid = (await (await addRes(ctx, { name: `R-${Math.random().toString(36).slice(2, 7)}`, hours_per_day: 8 })).json()).resource.id;
    const res = await assign(ctx, { order_id: orderId, resource_id: rid, estimated_hours: 5 });
    expect(res.status).toBe(200);
  });

  it('flags an overbooked resource-day (booked > capacity)', async () => {
    const ctx = await seedManufacturingClient();
    const rid = (await (await addRes(ctx, { name: `R-${Math.random().toString(36).slice(2, 7)}`, hours_per_day: 8 })).json()).resource.id;
    const o1 = await seedOrderDueToday(ctx);
    const o2 = await seedOrderDueToday(ctx);
    await assign(ctx, { order_id: o1, resource_id: rid, estimated_hours: 5 });
    await assign(ctx, { order_id: o2, resource_id: rid, estimated_hours: 6 });
    const slots = (await (await capacity(ctx)).json()).slots as Array<{ resource_id: string; day: string; booked: number; capacity: number; overbooked: boolean }>;
    const slot = slots.find((s) => s.resource_id === rid);
    expect(slot).toBeTruthy();
    expect(slot!.booked).toBe(11);
    expect(slot!.capacity).toBe(8);
    expect(slot!.overbooked).toBe(true);
  });

  it('404 assigning a foreign order or resource', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const orderId = await seedOrderDueToday(ctx);
    const foreignOrder = await seedOrderDueToday(other);
    const rid = (await (await addRes(ctx, { name: `R-${Math.random().toString(36).slice(2, 7)}`, hours_per_day: 8 })).json()).resource.id;
    const foreignRes = (await (await addRes(other, { name: `R-${Math.random().toString(36).slice(2, 7)}`, hours_per_day: 8 })).json()).resource.id;
    expect((await assign(ctx, { order_id: foreignOrder, resource_id: rid, estimated_hours: 1 })).status).toBe(404);
    expect((await assign(ctx, { order_id: orderId, resource_id: foreignRes, estimated_hours: 1 })).status).toBe(404);
  });

  it('412 not enabled; 403 for L2 without business.create on resource create', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await listRes(bare)).status).toBe(412);
    const ctx = await seedManufacturingClient();
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.business.view']);
    expect((await addRes(viewer, { name: 'X', hours_per_day: 8 })).status).toBe(403);
  });
});
