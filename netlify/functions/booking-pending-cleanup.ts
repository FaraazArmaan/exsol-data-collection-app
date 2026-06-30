// Scheduled function: cancels stale `pending` bookings (created >15 min ago, payment
// never completed), freeing the slot. Runs every 5 minutes across all tenants.
// NOTE: Netlify scheduled functions are greenfield in this repo — verify the cron
// syntax registers on first deploy (see Phase 3 plan).
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';

export const config = { schedule: '*/5 * * * *' };

const STALE_MINUTES = 15;

/** Flip pending bookings older than STALE_MINUTES → cancelled. Returns the count. */
export async function cleanupPendingBookings(sql: NeonQueryFunction<false, false>): Promise<number> {
  const rows = (await sql`
    UPDATE public.bookings
       SET status = 'cancelled'::booking_status, cancelled_at = now(),
           cancellation_reason = 'payment_timeout', updated_at = now()
     WHERE status = 'pending'
       AND created_at < now() - make_interval(mins => ${STALE_MINUTES})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length;
}

export default async function handler(): Promise<Response> {
  const n = await cleanupPendingBookings(db());
  return new Response(JSON.stringify({ cancelled: n }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
