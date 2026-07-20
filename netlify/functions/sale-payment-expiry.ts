// Scheduled function: expires online sale holds after the payment request's
// authoritative deadline, then releases any Inventory reservation. Pickup and
// cash sales have no payment request and are deliberately excluded.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { releaseSaleInventory } from './_shared/inventory-reservations';

export const config = { schedule: '*/5 * * * *' };

const BATCH = 100;
type ExpiredSale = { id: string; client_id: string };

export async function expireStaleSalePayments(sql: NeonQueryFunction<false, false>): Promise<{ expired: number; released: number }> {
  // Locking the sale before changing it makes this race safely with a payment
  // webhook: whichever settles the sale first wins, the other sees no candidate.
  const expired = (await sql`
    WITH candidates AS (
      SELECT s.id
      FROM public.sales s
      WHERE s.status = 'pending_payment'::sale_status
        AND EXISTS (
          SELECT 1 FROM public.payment_requests pr
          WHERE pr.client_id = s.bucket_id AND pr.source_type = 'sale' AND pr.source_id = s.id
            AND pr.status = 'open' AND pr.expires_at <= now()
        )
      ORDER BY s.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH}
    ), expired_sales AS (
      UPDATE public.sales s
      SET status = 'cancelled'::sale_status, cancelled_at = now()
      FROM candidates c
      WHERE s.id = c.id AND s.status = 'pending_payment'::sale_status
      RETURNING s.id, s.bucket_id AS client_id
    ), expired_requests AS (
      UPDATE public.payment_requests pr
      SET status = 'expired', updated_at = now()
      FROM expired_sales s
      WHERE pr.client_id = s.client_id AND pr.source_type = 'sale' AND pr.source_id = s.id AND pr.status = 'open'
      RETURNING pr.id
    ), expired_attempts AS (
      UPDATE public.payment_attempts pa
      SET status = 'expired', failure_reason = 'sale_payment_expired'
      WHERE pa.request_id IN (SELECT id FROM expired_requests) AND pa.status = 'created'
    )
    SELECT id, client_id FROM expired_sales
  `) as ExpiredSale[];

  // If a prior invocation stopped after cancelling the sale but before it
  // released stock, retry that durable half-state on the next five-minute run.
  const recovery = (await sql`
    SELECT DISTINCT s.id, s.bucket_id AS client_id
    FROM public.sales s
    JOIN public.payment_requests pr
      ON pr.client_id = s.bucket_id AND pr.source_type = 'sale' AND pr.source_id = s.id
    JOIN public.inventory_reservations r ON r.sale_id = s.id AND r.status = 'reserved'
    WHERE s.status = 'cancelled'::sale_status AND pr.status = 'expired'
    ORDER BY s.id
    LIMIT ${BATCH}
  `) as ExpiredSale[];

  let released = 0;
  const releaseQueue = [...expired, ...recovery.filter((sale) => !expired.some((row) => row.id === sale.id))];
  for (const sale of releaseQueue) {
    if (!(await releaseSaleInventory(sql, sale.client_id, sale.id))) {
      throw new Error(`inventory reservation release failed for expired sale ${sale.id}`);
    }
    released++;
    await logAudit(sql, {
      session: { kind: 'system' } as any,
      op: 'pos.sale.payment_expired',
      clientId: sale.client_id,
      targetType: 'sale',
      targetId: sale.id,
      detail: { reason: 'payment_timeout' },
    });
  }
  return { expired: expired.length, released };
}

export default async function handler(): Promise<Response> {
  const result = await expireStaleSalePayments(db());
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
