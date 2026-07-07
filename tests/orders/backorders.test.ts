// tests/orders/backorders.test.ts — Backordering (Task 3)
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { seedOrdersClient, seedSale, seedStock, makeBucketUserRequest, seedProducts } from './_helpers';
import backordersHandler from '../../netlify/functions/orders-backorders';
import backorderFulfillHandler from '../../netlify/functions/orders-backorder-fulfill';

const sql = neon(process.env.DATABASE_URL!);

describe('orders backorders', () => {
  it('POST create backorder → 201, status=queued', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Backorder Product ${Math.random().toString(36).slice(2)}` }]);

    const res = await backordersHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/backorders', {
        sale_id: saleId,
        product_id: productId,
        qty_ordered: 5,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.qty_ordered).toBe(5);
    expect(body.qty_fulfilled).toBe(0);
    expect(body.id).toBeTruthy();
  });

  it('GET list backorders → 200 array scoped to client', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `List Test Product ${Math.random().toString(36).slice(2)}` }]);

    // Insert directly
    await sql`
      INSERT INTO public.orders_backorders (client_id, sale_id, product_id, product_name_snap, qty_ordered)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, ${productId}::uuid, 'Test Product', 3)
    `;

    const res = await backordersHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/backorders'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((b: { sale_id: string }) => b.sale_id === saleId);
    expect(found).toBeDefined();
  });

  it('partial fulfil: stock 100, qty 3 → status=partially_fulfilled, stock=97, movement row', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Partial Fulfil ${Math.random().toString(36).slice(2)}` }]);
    await seedStock(ctx, productId!, 100);

    // Create backorder qty=10
    const createRes = await backordersHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/backorders', {
        sale_id: saleId,
        product_id: productId,
        qty_ordered: 10,
      }),
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    // Partial fulfil: qty=3
    const fulfillRes = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${id}`, { qty: 3 }),
    );
    expect(fulfillRes.status).toBe(200);
    const body = await fulfillRes.json();
    expect(body.status).toBe('partially_fulfilled');
    expect(Number(body.qty_fulfilled)).toBe(3);

    // Stock decremented
    const stockRows = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock
      WHERE client_id=${ctx.clientId}::uuid AND product_id=${productId}::uuid
    `) as Array<{ qty_on_hand: number }>;
    expect(Number(stockRows[0]!.qty_on_hand)).toBe(97);

    // Movement row inserted
    const movRows = (await sql`
      SELECT qty_delta, ref FROM public.stock_movements
      WHERE client_id=${ctx.clientId}::uuid AND product_id=${productId}::uuid
        AND ref=${'backorder:' + id}
    `) as Array<{ qty_delta: number; ref: string }>;
    expect(movRows.length).toBe(1);
    expect(Number(movRows[0]!.qty_delta)).toBe(-3);
    expect(movRows[0]!.ref).toBe('backorder:' + id);
  });

  it('full fulfil (remaining qty) → status=fulfilled, fulfilled_at set', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Full Fulfil ${Math.random().toString(36).slice(2)}` }]);
    await seedStock(ctx, productId!, 50);

    // Create backorder qty=4
    const createRes = await backordersHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/backorders', {
        sale_id: saleId,
        product_id: productId,
        qty_ordered: 4,
      }),
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    // Partial fulfil qty=2
    const p1 = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${id}`, { qty: 2 }),
    );
    expect(p1.status).toBe(200);
    expect((await p1.json()).status).toBe('partially_fulfilled');

    // Fulfil remaining qty=2
    const p2 = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${id}`, { qty: 2 }),
    );
    expect(p2.status).toBe(200);
    const body2 = await p2.json();
    expect(body2.status).toBe('fulfilled');
    expect(Number(body2.qty_fulfilled)).toBe(4);

    // fulfilled_at must be set
    const dbRows = (await sql`
      SELECT fulfilled_at FROM public.orders_backorders WHERE id=${id}::uuid
    `) as Array<{ fulfilled_at: string | null }>;
    expect(dbRows[0]!.fulfilled_at).not.toBeNull();
  });

  it('insufficient stock (stock 2, qty 5) → 409, NO stock change, NO movement, backorder unchanged', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Insuf Stock ${Math.random().toString(36).slice(2)}` }]);
    await seedStock(ctx, productId!, 2);

    // Create backorder qty=10
    const createRes = await backordersHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/backorders', {
        sale_id: saleId,
        product_id: productId,
        qty_ordered: 10,
      }),
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    // Try to fulfil 5 — should 409 (insufficient stock, only have 2)
    const fulfillRes = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${id}`, { qty: 5 }),
    );
    expect(fulfillRes.status).toBe(409);
    const errBody = await fulfillRes.json();
    expect(errBody.error.code).toBe('insufficient_stock');
    expect(Number(errBody.error.details.have)).toBe(2);
    expect(Number(errBody.error.details.need)).toBe(5);

    // Stock UNCHANGED — must still be 2
    const stockRows = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock
      WHERE client_id=${ctx.clientId}::uuid AND product_id=${productId}::uuid
    `) as Array<{ qty_on_hand: number }>;
    expect(Number(stockRows[0]!.qty_on_hand)).toBe(2);

    // NO stock_movements row
    const movRows = (await sql`
      SELECT id FROM public.stock_movements
      WHERE client_id=${ctx.clientId}::uuid AND product_id=${productId}::uuid
        AND ref=${'backorder:' + id}
    `) as Array<{ id: string }>;
    expect(movRows.length).toBe(0);

    // Backorder unchanged — still queued, qty_fulfilled=0
    const boRows = (await sql`
      SELECT status, qty_fulfilled FROM public.orders_backorders WHERE id=${id}::uuid
    `) as Array<{ status: string; qty_fulfilled: number }>;
    expect(boRows[0]!.status).toBe('queued');
    expect(Number(boRows[0]!.qty_fulfilled)).toBe(0);
  });

  it('qty > remaining → 400 qty_exceeds_remaining', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid' });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `QtyExceed ${Math.random().toString(36).slice(2)}` }]);
    await seedStock(ctx, productId!, 100);

    const createRes = await backordersHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/backorders', {
        sale_id: saleId,
        product_id: productId,
        qty_ordered: 3,
      }),
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const res = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${id}`, { qty: 5 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('qty_exceeds_remaining');
  });

  it('foreign / nonexistent backorder id → 404', async () => {
    const ctx = await seedOrdersClient();
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await backorderFulfillHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/backorder-fulfill/${fakeId}`, { qty: 1 }),
    );
    expect(res.status).toBe(404);
  });
});
