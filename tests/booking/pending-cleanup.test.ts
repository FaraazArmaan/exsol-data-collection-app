import { describe, it, expect, beforeAll } from 'vitest';
import { cleanupPendingBookings } from '../../netlify/functions/booking-pending-cleanup';
import { sqlClient, seedClientWithBooking, seedResource, makeService } from './_helpers';

const sql = sqlClient();
let clientId: string, resId: string, svc: string, nodeId: string;

beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  clientId = ctx.clientId; nodeId = ctx.ownerNodeId;
  resId = await seedResource(clientId, 'Sarah');
  svc = await makeService(clientId, { duration_min: 60 });
});

async function mkPending(range: string, ageMinutes: number): Promise<string> {
  const r = (await sql`
    INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name, created_at)
    VALUES (${clientId}, ${svc}, ${resId}, ${nodeId}, ${range}::tstzrange, 'pending', 'X',
            now() - make_interval(mins => ${ageMinutes}))
    RETURNING id`) as any[];
  return r[0].id;
}

async function statusOf(id: string): Promise<string> {
  const r = (await sql`SELECT status FROM public.bookings WHERE id = ${id}::uuid`) as any[];
  return r[0].status;
}

describe('cleanupPendingBookings', () => {
  it('cancels stale pending (>15 min) but leaves fresh pending + the slot reusable', async () => {
    const stale = await mkPending('[2032-01-01T09:00:00Z,2032-01-01T10:00:00Z)', 20);
    const fresh = await mkPending('[2032-01-02T09:00:00Z,2032-01-02T10:00:00Z)', 5);

    const n = await cleanupPendingBookings(sql);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await statusOf(stale)).toBe('cancelled');
    expect(await statusOf(fresh)).toBe('pending');

    // the cancelled slot is now free → a new booking on the same range succeeds
    const reuse = (await sql`INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
      VALUES (${clientId}, ${svc}, ${resId}, ${nodeId}, '[2032-01-01T09:00:00Z,2032-01-01T10:00:00Z)', 'confirmed', 'Y') RETURNING id`) as any[];
    expect(reuse[0].id).toBeTruthy();
  });
});
