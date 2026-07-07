import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-suppliers';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
  seedProducts,
} from '../pos/_helpers';
import { enableSupplyChain, rand } from './_helpers';
import { db } from '../../netlify/functions/_shared/db';

const sql = db();

async function seedSupplier(clientId: string, name?: string): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${clientId}::uuid, ${name ?? `Supplier ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function seedSupplierLink(
  clientId: string,
  productId: string,
  supplierId: string,
  isPrimary = false,
  leadTimeDays = 7,
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
    VALUES (${clientId}::uuid, ${productId}::uuid, ${supplierId}::uuid, ${leadTimeDays}::int, 5000, ${isPrimary})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('GET /api/supply-chain-suppliers', () => {
  it('returns products with supplier counts', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-suppliers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.productsWithSuppliers.length).toBeGreaterThanOrEqual(1);
    const entry = body.productsWithSuppliers.find((p: { productId: string }) => p.productId === pid);
    expect(entry).toBeDefined();
    expect(entry.supplierCount).toBe(1);
    expect(entry.primarySupplier).toBeTruthy();
  });

  it('returns supplier links for a specific product', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-suppliers?product=${pid}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links.length).toBe(1);
    expect(body.links[0].supplierId).toBe(sid);
    expect(body.links[0].isPrimary).toBe(true);
    expect(typeof body.links[0].unitCostCents).toBe('number');
  });

  it('is 403 for a sub without view key', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-suppliers'));
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-suppliers'));
    expect(res.status).toBe(412);
  });

  it('suggestedAlternate returns the non-primary supplier with the lowest lead time', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sidPrimary = await seedSupplier(ctx.clientId, `Primary ${rand()}`);
    const sidFast    = await seedSupplier(ctx.clientId, `Fast ${rand()}`);
    const sidSlow    = await seedSupplier(ctx.clientId, `Slow ${rand()}`);
    // Primary: lead 14; alternate fast: lead 5; alternate slow: lead 9
    await seedSupplierLink(ctx.clientId, pid!, sidPrimary, true,  14);
    await seedSupplierLink(ctx.clientId, pid!, sidFast,    false,  5);
    await seedSupplierLink(ctx.clientId, pid!, sidSlow,    false,  9);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-suppliers?product=${pid}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestedAlternate).not.toBeNull();
    expect(body.suggestedAlternate.supplierId).toBe(sidFast);
    expect(body.suggestedAlternate.leadTimeDays).toBe(5);
  });
});

describe('POST /api/supply-chain-suppliers', () => {
  it('creates a supplier link and returns 201', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);

    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-suppliers', {
      productId: pid,
      supplierId: sid,
      leadTimeDays: 5,
      unitCostCents: 3000,
      isPrimary: true,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.leadTimeDays).toBe(5);
    expect(body.unitCostCents).toBe(3000);
    expect(body.isPrimary).toBe(true);
  });

  it('upserts when the link already exists', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, false);

    // Update the existing link via POST (upsert).
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-suppliers', {
      productId: pid,
      supplierId: sid,
      leadTimeDays: 10,
      unitCostCents: 9900,
      isPrimary: false,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.leadTimeDays).toBe(10);
    expect(body.unitCostCents).toBe(9900);
  });

  it('primary exclusivity: setting isPrimary clears previous primary', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid1 = await seedSupplier(ctx.clientId);
    const sid2 = await seedSupplier(ctx.clientId);

    // Link sid1 as primary.
    await handler(makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-suppliers', {
      productId: pid, supplierId: sid1, leadTimeDays: 7, unitCostCents: 5000, isPrimary: true,
    }));

    // Link sid2 as primary — should demote sid1.
    await handler(makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-suppliers', {
      productId: pid, supplierId: sid2, leadTimeDays: 3, unitCostCents: 4000, isPrimary: true,
    }));

    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-suppliers?product=${pid}`));
    const body = await res.json();
    const primaries = body.links.filter((l: { isPrimary: boolean }) => l.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].supplierId).toBe(sid2);
  });

  it('is 403 without create key', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, ['supply-chain.products.view']);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);

    const res = await handler(makeBucketUserRequest(sub, 'POST', '/api/supply-chain-suppliers', {
      productId: pid, supplierId: sid, leadTimeDays: 7, unitCostCents: 0, isPrimary: false,
    }));
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/supply-chain-suppliers', {
      productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      supplierId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      leadTimeDays: 7, unitCostCents: 0, isPrimary: false,
    }));
    expect(res.status).toBe(412);
  });
});

describe('DELETE /api/supply-chain-suppliers/:id', () => {
  it('removes a supplier link', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    const linkId = await seedSupplierLink(ctx.clientId, pid!, sid);

    const res = await handler(makeBucketUserRequest(ctx, 'DELETE', `/api/supply-chain-suppliers/${linkId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(linkId);

    // Verify removed.
    const check = await handler(makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-suppliers?product=${pid}`));
    const checkBody = await check.json();
    expect(checkBody.links.length).toBe(0);
  });

  it('is 404 for a link belonging to another client', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const other = await seedClientWithProductsEnabled();
    await enableSupplyChain(other);
    await grantPerms(other.clientId, 1, []);
    const [pid] = await seedProducts(other.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(other.clientId);
    const linkId = await seedSupplierLink(other.clientId, pid!, sid);

    const res = await handler(makeBucketUserRequest(ctx, 'DELETE', `/api/supply-chain-suppliers/${linkId}`));
    expect(res.status).toBe(404);
  });

  it('is 403 without delete key', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, ['supply-chain.products.view']);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    const linkId = await seedSupplierLink(ctx.clientId, pid!, sid);

    const res = await handler(makeBucketUserRequest(sub, 'DELETE', `/api/supply-chain-suppliers/${linkId}`));
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'DELETE', '/api/supply-chain-suppliers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    expect(res.status).toBe(412);
  });
});
