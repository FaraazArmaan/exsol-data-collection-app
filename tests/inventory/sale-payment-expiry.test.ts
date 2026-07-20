import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { expireStaleSalePayments } from '../../netlify/functions/sale-payment-expiry';
import { seedProducts } from '../pos/_helpers';
import { readStock, seedInventoryClient, seedStock, setTrackingFlag } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

async function seedExpiringOnlineSale() {
  const ctx = await seedInventoryClient();
  await setTrackingFlag(ctx, true);
  const productId = (await seedProducts(ctx.clientId, [{ name: 'Expiring hold', sale_price_cents: 100 }]))[0]!;
  await seedStock(ctx, productId, 3);
  const sales = await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone, subtotal_cents, total_cents, created_by_user_node)
    VALUES (${ctx.clientId}::uuid, ${Math.floor(100000 + Math.random() * 900000)}, 'pending_payment', 'online', 'A', '1', 100, 100, ${ctx.userNodeId}::uuid)
    RETURNING id
  ` as Array<{ id: string }>;
  const saleId = sales[0]!.id;
  const lines = await sql`
    INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
    VALUES (${saleId}::uuid, ${productId}::uuid, 'Expiring hold', 100, 1, 100, 0)
    RETURNING id
  ` as Array<{ id: string }>;
  await sql`UPDATE public.inventory_stock SET qty_reserved = 1 WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${productId}::uuid`;
  await sql`
    INSERT INTO public.inventory_reservations (client_id, sale_id, sale_line_id, product_id, qty)
    VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, ${lines[0]!.id}::uuid, ${productId}::uuid, 1)
  `;
  const requests = await sql`
    INSERT INTO public.payment_requests
      (client_id, source_type, source_id, purpose, amount_minor, expires_at)
    VALUES (${ctx.clientId}::uuid, 'sale', ${saleId}::uuid, 'sale_total', 100, now() - interval '1 minute')
    RETURNING id
  ` as Array<{ id: string }>;
  await sql`
    INSERT INTO public.payment_attempts
      (client_id, request_id, provider, status, provider_order_id, amount_minor, expires_at)
    VALUES (${ctx.clientId}::uuid, ${requests[0]!.id}::uuid, 'razorpay', 'created', ${`expiry-${crypto.randomUUID()}`}, 100, now() - interval '1 minute')
  `;
  return { ctx, saleId, productId, requestId: requests[0]!.id };
}

describe('sale payment expiry', () => {
  it('expires the payment hold, releases stock, and leaves an audit trail', async () => {
    const { ctx, saleId, productId, requestId } = await seedExpiringOnlineSale();
    // Existing reservations still have to unwind if a tenant turns tracking off
    // after checkout; that switch must not strand qty_reserved.
    await setTrackingFlag(ctx, false);

    const sweep = await expireStaleSalePayments(sql);
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    expect(sweep.released).toBeGreaterThanOrEqual(1);
    expect(await readStock(ctx, productId)).toMatchObject({ qty_on_hand: 3, qty_reserved: 0 });
    const rows = await sql`
      SELECT s.status, pr.status AS request_status, pa.status AS attempt_status, r.status AS reservation_status
      FROM public.sales s
      JOIN public.payment_requests pr ON pr.id = ${requestId}::uuid
      JOIN public.payment_attempts pa ON pa.request_id = pr.id
      JOIN public.inventory_reservations r ON r.sale_id = s.id
      WHERE s.id = ${saleId}::uuid
    ` as Array<{ status: string; request_status: string; attempt_status: string; reservation_status: string }>;
    expect(rows[0]).toMatchObject({ status: 'cancelled', request_status: 'expired', attempt_status: 'expired', reservation_status: 'released' });
    const audit = await sql`
      SELECT op, detail FROM public.audit_log WHERE target_id = ${saleId} ORDER BY occurred_at DESC LIMIT 1
    ` as Array<{ op: string; detail: { reason: string } }>;
    expect(audit[0]).toMatchObject({ op: 'pos.sale.payment_expired', detail: { reason: 'payment_timeout' } });
  });

  it('does not expire a pending pickup sale without an online payment hold', async () => {
    const ctx = await seedInventoryClient();
    const sales = await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel, customer_name, customer_phone, subtotal_cents, total_cents, created_by_user_node, created_at)
      VALUES (${ctx.clientId}::uuid, ${Math.floor(100000 + Math.random() * 900000)}, 'pending_payment', 'pickup', 'A', '1', 100, 100, ${ctx.userNodeId}::uuid, now() - interval '1 hour')
      RETURNING id
    ` as Array<{ id: string }>;

    await expireStaleSalePayments(sql);
    const status = await sql`SELECT status FROM public.sales WHERE id = ${sales[0]!.id}::uuid` as Array<{ status: string }>;
    expect(status[0]?.status).toBe('pending_payment');
  });

  it('retries a cancelled sale whose reservation was not released by an interrupted prior run', async () => {
    const { ctx, saleId, productId, requestId } = await seedExpiringOnlineSale();
    await sql`UPDATE public.sales SET status = 'cancelled', cancelled_at = now() WHERE id = ${saleId}::uuid`;
    await sql`UPDATE public.payment_requests SET status = 'expired' WHERE id = ${requestId}::uuid`;

    const sweep = await expireStaleSalePayments(sql);
    expect(sweep.released).toBeGreaterThanOrEqual(1);
    expect(await readStock(ctx, productId)).toMatchObject({ qty_on_hand: 3, qty_reserved: 0 });
    const reservation = await sql`
      SELECT status FROM public.inventory_reservations WHERE sale_id = ${saleId}::uuid
    ` as Array<{ status: string }>;
    expect(reservation[0]?.status).toBe('released');
  });
});
