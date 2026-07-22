import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import cancelRemaining from '../../netlify/functions/orders-cancel-remaining';
import { makeBucketUserRequest, seedOrdersClient, seedProducts, seedSale } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('orders fulfillment exceptions', () => {
  it('releases only the unfulfilled reservation and creates a linked refund request', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'pickup', total: 500 });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Exception ${crypto.randomUUID()}`, price_cents: 100 }]);
    const line = await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Exception',100,5,500,1) RETURNING id` as Array<{id:string}>;
    await sql`INSERT INTO public.inventory_stock (client_id,product_id,qty_on_hand,qty_reserved) VALUES (${ctx.clientId}::uuid,${productId}::uuid,5,3)`;
    await sql`INSERT INTO public.inventory_reservations (client_id,sale_id,sale_line_id,product_id,qty,qty_consumed) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,${line[0]!.id}::uuid,${productId}::uuid,5,2)`;
    const fulfillment = await sql`INSERT INTO public.orders_fulfillments (client_id,sale_id,label) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,'Remainder') RETURNING id` as Array<{id:string}>;
    await sql`INSERT INTO public.orders_fulfillment_lines (fulfillment_id,sale_line_id,qty) VALUES (${fulfillment[0]!.id}::uuid,${line[0]!.id}::uuid,3)`;
    const res = await cancelRemaining(makeBucketUserRequest(ctx, 'POST', `/api/orders/cancel-remaining/${saleId}`, { sale_line_ids: [line[0]!.id], idempotency_key: crypto.randomUUID(), reason: 'customer cancelled remainder' }));
    expect(res.status).toBe(200);
    expect((await res.json()).refund_amount_cents).toBe(300);
    const rows = await sql`SELECT s.qty_on_hand,s.qty_reserved,r.qty_consumed,r.status,f.status AS fulfillment_status,(SELECT count(*)::int FROM public.orders_refunds o WHERE o.sale_id=${saleId}::uuid AND o.cancellation_id IS NOT NULL) AS refunds,(SELECT count(*)::int FROM public.stock_movements) AS movements FROM public.inventory_stock s JOIN public.inventory_reservations r ON r.product_id=s.product_id AND r.client_id=s.client_id JOIN public.orders_fulfillments f ON f.id=${fulfillment[0]!.id}::uuid WHERE r.sale_line_id=${line[0]!.id}::uuid` as Array<{qty_on_hand:number;qty_reserved:number;qty_consumed:number;status:string;fulfillment_status:string;refunds:number;movements:number}>;
    expect(rows[0]).toMatchObject({ qty_on_hand: 5, qty_reserved: 0, qty_consumed: 2, status: 'released', fulfillment_status: 'cancelled', refunds: 1 });
  });

  it('refuses to cancel a shipped line and leaves its reservation untouched', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'pickup', total: 100 });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Shipped ${crypto.randomUUID()}`, price_cents: 100 }]);
    const line = await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Shipped',100,1,100,1) RETURNING id` as Array<{id:string}>;
    await sql`INSERT INTO public.inventory_stock (client_id,product_id,qty_on_hand,qty_reserved) VALUES (${ctx.clientId}::uuid,${productId}::uuid,1,1)`;
    await sql`INSERT INTO public.inventory_reservations (client_id,sale_id,sale_line_id,product_id,qty) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,${line[0]!.id}::uuid,${productId}::uuid,1)`;
    const fulfillment = await sql`INSERT INTO public.orders_fulfillments (client_id,sale_id,label,status) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,'Shipped','shipped') RETURNING id` as Array<{id:string}>;
    await sql`INSERT INTO public.orders_fulfillment_lines (fulfillment_id,sale_line_id,qty) VALUES (${fulfillment[0]!.id}::uuid,${line[0]!.id}::uuid,1)`;
    const res = await cancelRemaining(makeBucketUserRequest(ctx, 'POST', `/api/orders/cancel-remaining/${saleId}`, { sale_line_ids: [line[0]!.id], idempotency_key: crypto.randomUUID() }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'fulfillment_already_shipped' } });
    const row = await sql`SELECT s.qty_reserved,r.status FROM public.inventory_stock s JOIN public.inventory_reservations r ON r.product_id=s.product_id AND r.client_id=s.client_id WHERE r.sale_line_id=${line[0]!.id}::uuid` as Array<{qty_reserved:number;status:string}>;
    expect(row[0]).toMatchObject({ qty_reserved: 1, status: 'reserved' });
  });
});
