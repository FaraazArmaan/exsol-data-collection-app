import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-risk';
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

async function seedStock(
  clientId: string,
  productId: string,
  qtyOnHand: number,
  reorderLevel: number,
): Promise<void> {
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${clientId}::uuid, ${productId}::uuid, ${qtyOnHand}::int, ${reorderLevel}::int)
    ON CONFLICT (client_id, product_id) DO UPDATE SET qty_on_hand = ${qtyOnHand}::int, reorder_level = ${reorderLevel}::int
  `;
}

async function seedPO(
  clientId: string,
  supplierId: string,
  productId: string,
  daysOffset: number,
): Promise<string> {
  // daysOffset: positive = future, negative = past. Computed in SQL with the SAME
  // tenant-tz day arithmetic the handler uses (date_trunc('day', now() AT TIME ZONE
  // clients.timezone)) — a TS-side `new Date()`/toISOString() seed renders the UTC
  // date and goes off-by-one whenever local date ≠ UTC date (e.g. 00:00–05:30 IST).
  const poRows = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
    SELECT ${clientId}::uuid, ${supplierId}::uuid, 'ordered',
           (date_trunc('day', now() AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date + ${daysOffset}::int),
           'test-po'
    FROM public.clients c WHERE c.id = ${clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  const poId = poRows[0]!.id;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${poId}::uuid, ${productId}::uuid, 5, 1000)
  `;
  return poId;
}

describe('GET /api/supply-chain-risk', () => {
  it('single_supplier: product with 0 supplier links is flagged (medium, stock healthy)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    // must have stock to be SC-active; healthy stock → medium severity
    await seedStock(ctx.clientId, pid!, 50, 10);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'single_supplier' && r.productId === pid);
    expect(match).toBeDefined();
    expect(match.severity).toBe('medium');
    expect(match.detail).toContain('0 supplier link');
  });

  it('single_supplier: physical product with no stock and no PO is NOT flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Ghost ${rand()}` }]);
    // 0 supplier links, no inventory_stock row, no purchase_order_items → not SC-active → not flagged
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'single_supplier' && r.productId === pid);
    expect(match).toBeUndefined();
  });

  it('single_supplier: product with 1 link is flagged (medium, stock healthy)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true);
    await seedStock(ctx.clientId, pid!, 50, 10); // healthy

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'single_supplier' && r.productId === pid);
    expect(match).toBeDefined();
    expect(match.severity).toBe('medium');
    expect(match.detail).toContain('1 supplier link');
  });

  it('single_supplier: product with 2+ links is NOT flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid1 = await seedSupplier(ctx.clientId);
    const sid2 = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid1, true);
    await seedSupplierLink(ctx.clientId, pid!, sid2, false);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'single_supplier' && r.productId === pid);
    expect(match).toBeUndefined();
  });

  it('single_supplier: low stock + single supplier = high severity', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true);
    await seedStock(ctx.clientId, pid!, 2, 10); // low stock: 2 <= 10

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'single_supplier' && r.productId === pid);
    expect(match).toBeDefined();
    expect(match.severity).toBe('high');
  });

  it('lead_time_collision: low stock + long lead primary = flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true, 21);
    await seedStock(ctx.clientId, pid!, 3, 10); // low: 3 <= 10, not 0

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'lead_time_collision' && r.productId === pid);
    expect(match).toBeDefined();
    expect(match.severity).toBe('medium');
    expect(match.detail).toContain('21-day');
  });

  it('lead_time_collision: low stock + short lead = NOT flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true, 7); // lead < 14
    await seedStock(ctx.clientId, pid!, 3, 10); // low stock

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'lead_time_collision' && r.productId === pid);
    expect(match).toBeUndefined();
  });

  it('lead_time_collision: healthy stock + long lead = NOT flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true, 21);
    await seedStock(ctx.clientId, pid!, 50, 10); // healthy

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'lead_time_collision' && r.productId === pid);
    expect(match).toBeUndefined();
  });

  it('lead_time_collision: qty_on_hand==0 → high severity', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedSupplierLink(ctx.clientId, pid!, sid, true, 21);
    await seedStock(ctx.clientId, pid!, 0, 10); // 0 on hand

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; productId: string }) => r.kind === 'lead_time_collision' && r.productId === pid);
    expect(match).toBeDefined();
    expect(match.severity).toBe('high');
  });

  it('overdue_po: past expected_on → flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    const poId = await seedPO(ctx.clientId, sid, pid!, -3); // 3 days ago

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; poId: string }) => r.kind === 'overdue_po' && r.poId === poId);
    expect(match).toBeDefined();
    expect(match.severity).toBe('medium');
    expect(match.detail).toContain('3 day(s) overdue');
  });

  it('overdue_po: future expected_on → NOT flagged', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    const poId = await seedPO(ctx.clientId, sid, pid!, 5); // 5 days in future

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; poId: string }) => r.kind === 'overdue_po' && r.poId === poId);
    expect(match).toBeUndefined();
  });

  it('overdue_po: >14 days overdue → high severity', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    const poId = await seedPO(ctx.clientId, sid, pid!, -20); // 20 days ago

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const match = body.risks.find((r: { kind: string; poId: string }) => r.kind === 'overdue_po' && r.poId === poId);
    expect(match).toBeDefined();
    expect(match.severity).toBe('high');
  });

  it('counts: tallies correctly', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    // 1 high single_supplier: low stock, 0 links
    const [pidLow] = await seedProducts(ctx.clientId, [{ name: `LowProd ${rand()}` }]);
    await seedStock(ctx.clientId, pidLow!, 2, 10); // low → high
    // 1 medium overdue po
    const [pid2] = await seedProducts(ctx.clientId, [{ name: `Po Prod ${rand()}` }]);
    const sid = await seedSupplier(ctx.clientId);
    await seedPO(ctx.clientId, sid, pid2!, -3);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // pidLow has 0 links + low stock → high single_supplier
    const highMatch = body.risks.find((r: { kind: string; productId: string; severity: string }) =>
      r.kind === 'single_supplier' && r.productId === pidLow && r.severity === 'high'
    );
    expect(highMatch).toBeDefined();
    expect(body.counts.high).toBeGreaterThanOrEqual(1);
    expect(body.counts.medium).toBeGreaterThanOrEqual(1);
    // Sorted: high before medium
    const highIdx = body.risks.findIndex((r: { severity: string }) => r.severity === 'high');
    const medIdx = body.risks.findIndex((r: { severity: string }) => r.severity === 'medium');
    if (highIdx !== -1 && medIdx !== -1) {
      expect(highIdx).toBeLessThan(medIdx);
    }
  });

  it('is 403 for sub without view key', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-risk'));
    expect(res.status).toBe(412);
  });
});
