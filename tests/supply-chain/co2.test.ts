import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-co2';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
  seedProducts,
} from '../pos/_helpers';
import { enableSupplyChain, rand } from './_helpers';
import { db } from '../../netlify/functions/_shared/db';

const sql = db();

async function seedCategory(clientId: string, name?: string): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.product_categories (client_id, name)
    VALUES (${clientId}::uuid, ${name ?? `Cat ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function seedSupplier(clientId: string): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${clientId}::uuid, ${`Supplier ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function seedPo(
  clientId: string,
  supplierId: string,
  productId: string,
  qty: number,
  daysOffset: number,
): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const expectedOn = d.toISOString().slice(0, 10);
  const poRows = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'ordered', ${expectedOn}::date)
    RETURNING id
  `) as Array<{ id: string }>;
  const poId = poRows[0]!.id;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${poId}::uuid, ${productId}::uuid, ${qty}::int, 1000)
  `;
  return poId;
}

function makePostReq(ctx: Parameters<typeof makeBucketUserRequest>[0], body: unknown): Request {
  return makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-co2', body);
}

describe('POST /api/supply-chain-co2 — factor upsert', () => {
  it('creates a client default factor (categoryId null)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const res = await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 1.5 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kgPerUnit).toBe(1.5);
    expect(body.categoryId).toBeNull();
    expect(body.id).toBeTruthy();
  });

  it('updates an existing default factor on upsert', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 1.0 }));
    const res = await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 2.5 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kgPerUnit).toBe(2.5);
  });

  it('creates a per-category factor', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const catId = await seedCategory(ctx.clientId);

    const res = await handler(makePostReq(ctx, { categoryId: catId, kgPerUnit: 0.75 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kgPerUnit).toBe(0.75);
    expect(body.categoryId).toBe(catId);
  });

  it('updates existing per-category factor on upsert', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const catId = await seedCategory(ctx.clientId);

    await handler(makePostReq(ctx, { categoryId: catId, kgPerUnit: 1.0 }));
    const res = await handler(makePostReq(ctx, { categoryId: catId, kgPerUnit: 3.3 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kgPerUnit).toBe(3.3);
  });

  it('rejects kgPerUnit < 0 with 400', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const res = await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: -1 }));
    expect(res.status).toBe(400);
  });

  it('rejects foreign categoryId not belonging to the client with 404', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    // Use a random UUID that doesn't belong to this client
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await handler(makePostReq(ctx, { categoryId: fakeId, kgPerUnit: 1.0 }));
    expect(res.status).toBe(404);
  });

  it('is 403 for sub without edit key', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, ['supply-chain.products.view']);
    const res = await handler(makeBucketUserRequest(sub, 'POST', '/api/supply-chain-co2', { categoryId: null, kgPerUnit: 1.0 }));
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 1.0 }));
    expect(res.status).toBe(412);
  });
});

describe('GET /api/supply-chain-co2 — CO2 math + trend', () => {
  it('CO2 math: uses per-category factor', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const catId = await seedCategory(ctx.clientId);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    // Set category on product
    await sql`UPDATE public.products SET category_id = ${catId}::uuid WHERE id = ${pid!}::uuid`;

    // Seed a factor: 2 kg CO2 per unit for this category
    await handler(makePostReq(ctx, { categoryId: catId, kgPerUnit: 2.0 }));

    // Seed a default factor: 0.5
    await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 0.5 }));

    const supId = await seedSupplier(ctx.clientId);
    // PO with qty 10, expected today
    const poId = await seedPo(ctx.clientId, supId, pid!, 10, 0);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-co2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const poEntry = body.byPo.find((p: { poId: string }) => p.poId === poId);
    expect(poEntry).toBeDefined();
    // 10 * 2.0 = 20 kg
    expect(poEntry.kgCo2).toBeCloseTo(20, 3);
  });

  it('CO2 math: falls back to default when category exists but has no factor row', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    // Create a category but do NOT create a per-category co2 factor for it
    const catId = await seedCategory(ctx.clientId);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    // Assign the product to that category
    await sql`UPDATE public.products SET category_id = ${catId}::uuid WHERE id = ${pid!}::uuid`;

    // Seed only the client DEFAULT factor (category_id NULL)
    await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 3.0 }));

    const supId = await seedSupplier(ctx.clientId);
    const poId = await seedPo(ctx.clientId, supId, pid!, 7, 1);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-co2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const poEntry = body.byPo.find((p: { poId: string }) => p.poId === poId);
    expect(poEntry).toBeDefined();
    // Category exists but no factor row for it → falls back to default: 7 × 3.0 = 21 kg
    expect(poEntry.kgCo2).toBeCloseTo(21, 3);
  });

  it('CO2 math: falls back to default for uncategorized product', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    // Insert default factor only (no per-category)
    await handler(makePostReq(ctx, { categoryId: null, kgPerUnit: 1.0 }));

    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    // Product has no category (category_id = NULL by default)

    const supId = await seedSupplier(ctx.clientId);
    const poId = await seedPo(ctx.clientId, supId, pid!, 5, 0);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-co2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const poEntry = body.byPo.find((p: { poId: string }) => p.poId === poId);
    expect(poEntry).toBeDefined();
    // 5 * 1.0 = 5 kg
    expect(poEntry.kgCo2).toBeCloseTo(5, 3);
  });

  it('trend has exactly 30 zero-filled rows', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-co2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trend).toHaveLength(30);
    // All zero when no POs exist in range
    for (const row of body.trend) {
      expect(typeof row.day).toBe('string');
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.kgCo2).toBe('number');
    }
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-co2'));
    expect(res.status).toBe(412);
  });
});
