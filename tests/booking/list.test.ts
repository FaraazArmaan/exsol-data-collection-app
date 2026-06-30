import { describe, it, expect, beforeAll } from 'vitest';
import list from '../../netlify/functions/booking-list';
import { sqlClient, seedClientWithBooking, enableBooking, grantBookingPerms, seedResource, makeService, bookingRequest, demoteToL2 } from './_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let resId: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.customers.view']);
  resId = await seedResource(ctx.clientId, 'Sarah');
  const svc = await makeService(ctx.clientId, { duration_min: 60 });
  // two confirmed bookings on 2026-08-17, one blocked on 2026-08-18
  await sql`INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
    VALUES (${ctx.clientId}, ${svc}, ${resId}, ${ctx.ownerNodeId}, '[2026-08-17T03:30:00Z,2026-08-17T04:30:00Z)', 'confirmed', 'A'),
           (${ctx.clientId}, ${svc}, ${resId}, ${ctx.ownerNodeId}, '[2026-08-17T05:00:00Z,2026-08-17T06:00:00Z)', 'pending', 'B')`;
  await sql`INSERT INTO public.bookings (bucket_id, resource_id, time_range, status)
    VALUES (${ctx.clientId}, ${resId}, '[2026-08-18T03:30:00Z,2026-08-18T05:30:00Z)', 'blocked')`;
});

describe('GET /api/booking/list', () => {
  it('returns bookings within the date window', async () => {
    const r = await list(bookingRequest(ctx, 'GET', '/api/booking/list?from=2026-08-17&to=2026-08-17'));
    expect(r.status).toBe(200);
    const { bookings } = await r.json();
    expect(bookings).toHaveLength(2);
    expect(bookings[0].start_at < bookings[1].start_at).toBe(true); // ordered
  });

  it('filters by status', async () => {
    const r = await list(bookingRequest(ctx, 'GET', '/api/booking/list?from=2026-08-17&to=2026-08-18&status=blocked'));
    const { bookings } = await r.json();
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('blocked');
  });

  it('403 when L2 user lacks booking.customers.view', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const sub = await demoteToL2(owner);
    await grantBookingPerms(sub.clientId, 2, ['booking.employees.view']); // not customers.view
    const r = await list(bookingRequest(sub, 'GET', '/api/booking/list'));
    expect(r.status).toBe(403);
  });
});
