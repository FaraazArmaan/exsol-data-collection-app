import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import maintHandler from '../../netlify/functions/manufacturing-maintenance';
import scrapHandler from '../../netlify/functions/manufacturing-scrap';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedStock } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);
type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;

const listMaint = (ctx: Ctx, qs = '') => maintHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/maintenance${qs}`));
const addMaint = (ctx: Ctx, body: unknown) => maintHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/maintenance', body));
const listScrap = (ctx: Ctx) => scrapHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/scrap'));
const doScrap = (ctx: Ctx, body: unknown) => scrapHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/scrap', body));
const readStock = async (ctx: Ctx, productId: string) =>
  Number(((await sql`SELECT qty_on_hand FROM public.inventory_stock WHERE client_id = ${ctx.clientId} AND product_id = ${productId} LIMIT 1`) as Array<{ qty_on_hand: number }>)[0]?.qty_on_hand ?? 0);

describe('manufacturing maintenance / downtime', () => {
  it('logs maintenance and downtime, filters by kind', async () => {
    const ctx = await seedManufacturingClient();
    expect((await addMaint(ctx, { kind: 'maintenance', reason: 'Belt swap', minutes: 30, resource_label: 'Line 1' })).status).toBe(201);
    expect((await addMaint(ctx, { kind: 'downtime', reason: 'Power cut', minutes: 45 })).status).toBe(201);
    const downtime = (await (await listMaint(ctx, '?kind=downtime')).json()).logs as Array<{ kind: string; reason: string }>;
    expect(downtime.every((l) => l.kind === 'downtime')).toBe(true);
    expect(downtime.some((l) => l.reason === 'Power cut')).toBe(true);
  });

  it('400 reason_required / kind_invalid', async () => {
    const ctx = await seedManufacturingClient();
    expect((await addMaint(ctx, { kind: 'maintenance', reason: '  ' })).status).toBe(400);
    const res = await addMaint(ctx, { kind: 'explosion', reason: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('kind_invalid');
  });

  it('412 not enabled; 403 for L2 without business.create; 201 with it', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await listMaint(bare)).status).toBe(412);
    const ctx = await seedManufacturingClient();
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.edit']);
    expect((await addMaint(viewer, { kind: 'maintenance', reason: 'x' })).status).toBe(403);
    const creator = await seedSubordinateUser(await seedManufacturingClient(), 2, ['manufacturing.business.create']);
    expect((await addMaint(creator, { kind: 'maintenance', reason: 'x' })).status).toBe(201);
  });
});

describe('manufacturing scrap', () => {
  it('scraps stock: decrements, writes adjustment movement, logs', async () => {
    const ctx = await seedManufacturingClient();
    const [p] = await seedProducts(ctx.clientId, [{ name: 'Widget' }]);
    await seedStock(ctx, p!, 30);
    const res = await doScrap(ctx, { product_id: p, qty: 4, reason: 'Damaged' });
    expect(res.status).toBe(200);
    expect(await readStock(ctx, p!)).toBe(26);
    const mv = (await sql`SELECT qty_delta FROM public.stock_movements WHERE client_id = ${ctx.clientId} AND product_id = ${p} AND ref LIKE 'scrap%'`) as Array<{ qty_delta: number }>;
    expect(mv.some((m) => Number(m.qty_delta) === -4)).toBe(true);
    const logs = (await (await listScrap(ctx)).json()).logs as Array<{ product_id: string; qty: number }>;
    expect(logs.some((l) => l.product_id === p && l.qty === 4)).toBe(true);
  });

  it('400 when scrapping more than on hand', async () => {
    const ctx = await seedManufacturingClient();
    const [p] = await seedProducts(ctx.clientId, [{ name: 'W' }]);
    await seedStock(ctx, p!, 2);
    const res = await doScrap(ctx, { product_id: p, qty: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('insufficient_stock');
    expect(await readStock(ctx, p!)).toBe(2);
  });

  it('404 scrapping a foreign-client product; 403 for L2 without products.edit', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const [foreign] = await seedProducts(other.clientId, [{ name: 'F' }]);
    await seedStock(other, foreign!, 10);
    expect((await doScrap(ctx, { product_id: foreign, qty: 1 })).status).toBe(404);
    const [p] = await seedProducts(ctx.clientId, [{ name: 'W' }]);
    await seedStock(ctx, p!, 10);
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.view']);
    expect((await doScrap(viewer, { product_id: p, qty: 1 })).status).toBe(403);
  });
});
