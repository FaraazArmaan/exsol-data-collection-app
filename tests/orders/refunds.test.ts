// tests/orders/refunds.test.ts — Return/Refund workflow (Task 2)
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { seedOrdersClient, seedSale, makeBucketUserRequest } from './_helpers';
import refundsHandler from '../../netlify/functions/orders-refunds';
import refundAdvanceHandler from '../../netlify/functions/orders-refund-advance';

const sql = neon(process.env.DATABASE_URL!);

describe('orders refunds', () => {
  it('POST create partial refund → 201, state=requested', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 5000 });

    const res = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 2000,
        reason: 'partial test',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.state).toBe('requested');
    expect(body.id).toBeTruthy();
  });

  it('GET list refunds → 200 array', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 3000 });
    await sql`
      INSERT INTO public.orders_refunds (client_id, sale_id, amount_cents, reason, requested_by)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, 1000, 'get-test', ${ctx.userNodeId}::uuid)
    `;

    const res = await refundsHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/refunds'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((r: { sale_id: string }) => r.sale_id === saleId);
    expect(found).toBeDefined();
  });

  it('cannot approve an Orders refund that has no configured provider capture', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 5000 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 2000,
      }),
    );
    expect(r.status).toBe(201);
    const { id } = await r.json();

    const r2 = await refundAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${id}`, { to: 'approved' }),
    );
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe('razorpay_not_configured');
  });

  it('manual completion is unavailable even for a fully paid sale', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 3000 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 3000,
      }),
    );
    const { id } = await r.json();

    const r3 = await refundAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${id}`, { to: 'completed' }),
    );
    expect(r3.status).toBe(409);
    expect((await r3.json()).error.code).toBe('illegal_transition');
  });

  it('does not approve an uncollected sale as a provider refund', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'pending_payment', total: 2000 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 2000,
      }),
    );
    const { id } = await r.json();

    const r3 = await refundAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${id}`, { to: 'approved' }),
    );
    expect(r3.status).toBe(409);
    expect((await r3.json()).error.code).toBe('razorpay_not_configured');
  });

  it('amount > total → 400 amount_invalid', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });

    const res = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 9999,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('amount_invalid');
  });

  it('foreign sale → 404 sale_not_found', async () => {
    const ctx = await seedOrdersClient();
    const fakeSaleId = '00000000-0000-0000-0000-000000000001';

    const res = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: fakeSaleId,
        amount_cents: 500,
      }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('sale_not_found');
  });

  it('advance requested→rejected → 200, DB state=rejected', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 1000,
      }),
    );
    expect(r.status).toBe(201);
    const { id } = await r.json();

    const r2 = await refundAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${id}`, { to: 'rejected' }),
    );
    expect(r2.status).toBe(200);
    expect((await r2.json()).state).toBe('rejected');

    const rows = await sql`SELECT state FROM public.orders_refunds WHERE id = ${id}::uuid`;
    expect(rows[0]?.state).toBe('rejected');
  });

  it('cross-tenant refund-advance → 404', async () => {
    const ctxA = await seedOrdersClient();
    const { saleId } = await seedSale(ctxA, { status: 'paid', total: 1500 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctxA, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 750,
      }),
    );
    expect(r.status).toBe(201);
    const { id } = await r.json();

    // Client B attempts to advance client A's refund
    const ctxB = await seedOrdersClient();
    const r2 = await refundAdvanceHandler(
      makeBucketUserRequest(ctxB, 'POST', `/api/orders/refund-advance/${id}`, { to: 'approved' }),
    );
    expect(r2.status).toBe(404);
  });

  it('aggregate refund cap: 60%+60% of total → 400 refund_exceeds_total', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 10000 });

    const r1 = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 6000,
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 6000,
      }),
    );
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe('refund_exceeds_total');
  });

  it('aggregate refund cap: 60%+40% of total → 201 (sums exactly to total)', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 10000 });

    const r1 = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 6000,
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 4000,
      }),
    );
    expect(r2.status).toBe(201);
  });

  it('illegal transition requested→completed → 409 illegal_transition', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });

    const r = await refundsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
        sale_id: saleId,
        amount_cents: 500,
      }),
    );
    const { id } = await r.json();

    // Skip approved; try to jump straight to completed
    const r2 = await refundAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${id}`, { to: 'completed' }),
    );
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe('illegal_transition');
  });
});
