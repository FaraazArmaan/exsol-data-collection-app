import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import pickups from '../../netlify/functions/orders-pickups';
import collect from '../../netlify/functions/orders-pickup-collect';
import { makeBucketUserRequest, seedOrdersClient, seedProducts, seedSale } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('orders pickups', () => {
  it('records ready and collected proof idempotently without changing stock', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'pickup', total: 100 });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Pickup ${crypto.randomUUID()}`, price_cents: 100 }]);
    const lines = await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Pickup',100,1,100,1) RETURNING id` as Array<{ id:string }>;
    const fulfillment = await sql`INSERT INTO public.orders_fulfillments (client_id,sale_id,label,status) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,'Counter','packed') RETURNING id` as Array<{ id:string }>;
    await sql`INSERT INTO public.orders_fulfillment_lines (fulfillment_id,sale_line_id,qty) VALUES (${fulfillment[0]!.id}::uuid,${lines[0]!.id}::uuid,1)`;
    const readyKey = crypto.randomUUID();
    const ready = await pickups(makeBucketUserRequest(ctx, 'POST', '/api/orders/pickups', { sale_id: saleId, idempotency_key: readyKey }));
    expect(ready.status).toBe(201);
    const handoff = await ready.json();
    const retry = await pickups(makeBucketUserRequest(ctx, 'POST', '/api/orders/pickups', { sale_id: saleId, idempotency_key: readyKey }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(handoff.id);
    await sql`UPDATE public.orders_fulfillments SET status='fulfilled',fulfilled_at=now() WHERE id=${fulfillment[0]!.id}::uuid`;
    const collected = await collect(makeBucketUserRequest(ctx, 'POST', `/api/orders/pickups/${handoff.id}/collect`, { collector_name: 'A. Customer', collector_phone_last4: '1234', idempotency_key: crypto.randomUUID() }));
    expect(collected.status).toBe(200);
    expect(await collected.json()).toMatchObject({ status: 'collected', collector_phone_last4: '1234' });
  });
});
