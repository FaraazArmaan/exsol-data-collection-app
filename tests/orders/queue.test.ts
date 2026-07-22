import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import queueHandler from '../../netlify/functions/orders-queue';
import { makeBucketUserRequest, seedOrdersClient, seedProducts, seedSale } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('orders queue', () => {
  it('returns an Orders-owned, tenant-scoped projection with a derived cancelled-remainder label', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'pickup', total: 500 });
    const [firstProduct, secondProduct] = await seedProducts(ctx.clientId, [
      { name: `Queue shipped ${crypto.randomUUID()}`, price_cents: 100 },
      { name: `Queue cancelled ${crypto.randomUUID()}`, price_cents: 100 },
    ]);
    const lines = await sql`
      INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${firstProduct}::uuid, 'Queue shipped', 100, 2, 200, 1),
        (${saleId}::uuid, ${secondProduct}::uuid, 'Queue cancelled', 100, 3, 300, 2)
      RETURNING id, product_id
    ` as Array<{ id: string; product_id: string }>;
    const shippedLine = lines.find((line) => line.product_id === firstProduct)!;
    const cancelledLine = lines.find((line) => line.product_id === secondProduct)!;
    const fulfillment = await sql`
      INSERT INTO public.orders_fulfillments (client_id, sale_id, label, status)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, 'Shipment one', 'shipped')
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`INSERT INTO public.orders_fulfillment_lines (fulfillment_id, sale_line_id, qty) VALUES (${fulfillment[0]!.id}::uuid, ${shippedLine.id}::uuid, 2)`;
    const cancellation = await sql`
      INSERT INTO public.orders_fulfillment_cancellations (client_id, sale_id, idempotency_key, created_by)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, ${crypto.randomUUID()}, ${ctx.userNodeId}::uuid)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`INSERT INTO public.orders_fulfillment_cancellation_lines (cancellation_id, sale_line_id, qty, refund_amount_cents) VALUES (${cancellation[0]!.id}::uuid, ${cancelledLine.id}::uuid, 3, 300)`;
    await sql`INSERT INTO public.orders_refunds (client_id, sale_id, amount_cents, cancellation_id) VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, 300, ${cancellation[0]!.id}::uuid)`;

    // In-store completion belongs to POS and must not leak into the Orders queue.
    await seedSale(ctx, { status: 'fulfilled', channel: 'instore', total: 999 });
    const other = await seedOrdersClient();
    await seedSale(other, { status: 'paid', channel: 'pickup', total: 99999 });

    const res = await queueHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/queue'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.orders.find((order: { id: string }) => order.id === saleId);
    expect(row).toMatchObject({
      ordered_qty: 5,
      fulfilled_qty: 2,
      cancelled_qty: 3,
      remaining_qty: 0,
      operational_state: 'remaining_cancelled',
      refund_state: 'requested',
    });
    expect(body.orders).toHaveLength(1);
  });

  it('validates filters before querying the queue', async () => {
    const ctx = await seedOrdersClient();
    const res = await queueHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/queue?status=unknown'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_query' } });
  });
});
