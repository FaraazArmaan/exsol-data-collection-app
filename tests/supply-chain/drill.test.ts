import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-drill';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
  seedProducts,
} from '../pos/_helpers';
import { enableSupplyChain, rand } from './_helpers';
import { db } from '../../netlify/functions/_shared/db';

const sql = db();

async function seedMovements(clientId: string, productId: string): Promise<void> {
  await sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_at)
    VALUES
      (${clientId}::uuid, ${productId}::uuid, -5,  'sale',     ${`ref-${rand()}`}, now() - interval '1 day'),
      (${clientId}::uuid, ${productId}::uuid,  20, 'purchase', ${`ref-${rand()}`}, now() - interval '2 days'),
      (${clientId}::uuid, ${productId}::uuid, -3,  'sale',     ${`ref-${rand()}`}, now() - interval '3 days')
  `;
}

async function seedPoWithItems(
  clientId: string,
  productId: string,
): Promise<{ poId: string }> {
  const supplierRows = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${clientId}::uuid, ${`Supplier ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const supplierId = supplierRows[0]!.id;
  const poRows = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, notes)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'ordered', 'test')
    RETURNING id
  `) as Array<{ id: string }>;
  const poId = poRows[0]!.id;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${poId}::uuid, ${productId}::uuid, 10, 5000)
  `;
  return { poId };
}

async function seedProductionOrderWithBom(
  clientId: string,
  outputProductId: string,
  componentProductId: string,
): Promise<{ orderId: string; bomId: string }> {
  const bomRows = (await sql`
    INSERT INTO public.boms (client_id, output_product_id, name)
    VALUES (${clientId}::uuid, ${outputProductId}::uuid, ${`BOM ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const bomId = bomRows[0]!.id;
  await sql`
    INSERT INTO public.bom_components (bom_id, component_product_id, qty)
    VALUES (${bomId}::uuid, ${componentProductId}::uuid, 4)
  `;
  const orderRows = (await sql`
    INSERT INTO public.production_orders (client_id, bom_id, qty, status)
    VALUES (${clientId}::uuid, ${bomId}::uuid, 20, 'in_progress')
    RETURNING id
  `) as Array<{ id: string }>;
  return { orderId: orderRows[0]!.id, bomId };
}

// ─── product-movements ────────────────────────────────────────────────────────

describe('drill: product-movements', () => {
  it('returns movements for the product (ordered newest-first)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const [pid] = await seedProducts(ctx.clientId, [{ name: `Prod ${rand()}` }]);
    await seedMovements(ctx.clientId, pid!);

    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?type=product-movements&id=${pid}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBe(3);
    // newest first
    expect(body.rows[0].type).toBe('sale');
    expect(body.rows[0].qtyDelta).toBe(-5);
    expect(body.rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns empty rows for a product belonging to another client (tenant isolation)', async () => {
    const ctxA = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxA);
    await grantPerms(ctxA.clientId, 1, []);

    const ctxB = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxB);
    const [pidB] = await seedProducts(ctxB.clientId, [{ name: `Prod ${rand()}` }]);
    await seedMovements(ctxB.clientId, pidB!);

    // Client A queries client B's product
    const res = await handler(
      makeBucketUserRequest(ctxA, 'GET', `/api/supply-chain-drill?type=product-movements&id=${pidB}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(0);
  });
});

// ─── po-items ─────────────────────────────────────────────────────────────────

describe('drill: po-items', () => {
  it('returns items for the PO with correct totals and product name', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const prodName = `Prod ${rand()}`;
    const [pid] = await seedProducts(ctx.clientId, [{ name: prodName }]);
    const { poId } = await seedPoWithItems(ctx.clientId, pid!);

    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?type=po-items&id=${poId}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].product).toBe(prodName);
    expect(body.rows[0].qty).toBe(10);
    expect(body.rows[0].unitCostCents).toBe(5000);
    expect(body.rows[0].lineTotalCents).toBe(50000);
  });

  it('returns empty rows for a PO belonging to another client (tenant isolation)', async () => {
    const ctxA = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxA);
    await grantPerms(ctxA.clientId, 1, []);

    const ctxB = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxB);
    const [pidB] = await seedProducts(ctxB.clientId, [{ name: `Prod ${rand()}` }]);
    const { poId: poIdB } = await seedPoWithItems(ctxB.clientId, pidB!);

    // Client A queries client B's PO
    const res = await handler(
      makeBucketUserRequest(ctxA, 'GET', `/api/supply-chain-drill?type=po-items&id=${poIdB}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(0);
  });
});

// ─── production-bom ───────────────────────────────────────────────────────────

describe('drill: production-bom', () => {
  it('returns BOM components for the production order with component name', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const compName = `Comp ${rand()}`;
    const [outProd, compProd] = await seedProducts(ctx.clientId, [
      { name: `Out ${rand()}` },
      { name: compName },
    ]);
    const { orderId } = await seedProductionOrderWithBom(ctx.clientId, outProd!, compProd!);

    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?type=production-bom&id=${orderId}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].component).toBe(compName);
    expect(body.rows[0].qty).toBe(4);
  });

  it('returns empty rows for a production order belonging to another client (tenant isolation)', async () => {
    const ctxA = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxA);
    await grantPerms(ctxA.clientId, 1, []);

    const ctxB = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctxB);
    const [outB, compB] = await seedProducts(ctxB.clientId, [
      { name: `Out ${rand()}` },
      { name: `Comp ${rand()}` },
    ]);
    const { orderId: orderIdB } = await seedProductionOrderWithBom(ctxB.clientId, outB!, compB!);

    // Client A queries client B's production order
    const res = await handler(
      makeBucketUserRequest(ctxA, 'GET', `/api/supply-chain-drill?type=production-bom&id=${orderIdB}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(0);
  });
});

// ─── validation ───────────────────────────────────────────────────────────────

describe('drill: input validation', () => {
  it('returns 400 invalid_type for an unknown type', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const fakeId = crypto.randomUUID();
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?type=bad-type&id=${fakeId}`),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_type');
  });

  it('returns 400 invalid_id for a non-UUID id', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-drill?type=product-movements&id=not-a-uuid'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_id');
  });

  it('returns 400 invalid_type when type is missing', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    const fakeId = crypto.randomUUID();
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?id=${fakeId}`),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_type');
  });
});

// ─── authz ────────────────────────────────────────────────────────────────────

describe('drill: authz', () => {
  it('is 403 for a sub without supply-chain.products.view', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, []);
    const fakeId = crypto.randomUUID();
    const res = await handler(
      makeBucketUserRequest(sub, 'GET', `/api/supply-chain-drill?type=product-movements&id=${fakeId}`),
    );
    expect(res.status).toBe(403);
  });

  it('is 412 when supply-chain is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    // do NOT call enableSupplyChain
    await grantPerms(ctx.clientId, 1, []);
    const fakeId = crypto.randomUUID();
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/supply-chain-drill?type=product-movements&id=${fakeId}`),
    );
    expect(res.status).toBe(412);
  });
});
