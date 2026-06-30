import { describe, it, expect, beforeAll } from 'vitest';
import detail from '../../netlify/functions/booking-detail';
import { sqlClient, seedClientWithBooking, enableBooking, grantBookingPerms, seedResource, makeService, bookingRequest } from './_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let resId: string, svc: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.customers.view', 'booking.customers.edit']);
  resId = await seedResource(ctx.clientId, 'Sarah');
  svc = await makeService(ctx.clientId, { duration_min: 60 });
});

async function mkBooking(range: string, status = 'confirmed'): Promise<string> {
  const r = (await sql`INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
    VALUES (${ctx.clientId}, ${svc}, ${resId}, ${ctx.ownerNodeId}, ${range}::tstzrange, ${status}, 'X') RETURNING id`) as any[];
  return r[0].id;
}

describe('GET/PATCH /api/booking/detail/:id', () => {
  it('GET returns a booking; cross-tenant → 404', async () => {
    const id = await mkBooking('[2030-08-17T03:30:00Z,2030-08-17T04:30:00Z)');
    expect((await detail(bookingRequest(ctx, 'GET', `/api/booking/detail/${id}`))).status).toBe(200);
    const other = await seedClientWithBooking(); await enableBooking(other.clientId);
    await grantBookingPerms(other.clientId, 1, ['booking.customers.view']);
    expect((await detail(bookingRequest(other, 'GET', `/api/booking/detail/${id}`))).status).toBe(404);
  });

  it('vendor cancel works (bypasses cutoff)', async () => {
    const id = await mkBooking('[2030-08-17T05:00:00Z,2030-08-17T06:00:00Z)');
    const r = await detail(bookingRequest(ctx, 'PATCH', `/api/booking/detail/${id}`, { action: 'cancel', reason: 'customer called' }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe('cancelled');
    expect(j.cancellation_reason).toBe('customer called');
  });

  it('complete before the slot ends → 409 too_early; after → completed', async () => {
    const future = await mkBooking('[2030-08-17T07:00:00Z,2030-08-17T08:00:00Z)');
    expect((await detail(bookingRequest(ctx, 'PATCH', `/api/booking/detail/${future}`, { action: 'complete' }))).status).toBe(409);
    const past = await mkBooking('[2020-01-01T03:30:00Z,2020-01-01T04:30:00Z)');
    const done = await detail(bookingRequest(ctx, 'PATCH', `/api/booking/detail/${past}`, { action: 'complete' }));
    expect(done.status).toBe(200);
    expect((await done.json()).status).toBe('completed');
  });

  it('illegal transition (complete from pending) → 409', async () => {
    const id = await mkBooking('[2020-02-01T03:30:00Z,2020-02-01T04:30:00Z)', 'pending');
    expect((await detail(bookingRequest(ctx, 'PATCH', `/api/booking/detail/${id}`, { action: 'complete' }))).status).toBe(409);
  });

  it('unblock hard-deletes a blocked row', async () => {
    const r = (await sql`INSERT INTO public.bookings (bucket_id, resource_id, time_range, status)
      VALUES (${ctx.clientId}, ${resId}, '[2030-09-01T03:30:00Z,2030-09-01T05:30:00Z)', 'blocked') RETURNING id`) as any[];
    const del = await detail(bookingRequest(ctx, 'PATCH', `/api/booking/detail/${r[0].id}`, { action: 'unblock' }));
    expect((await del.json()).deleted).toBe(true);
    expect((await detail(bookingRequest(ctx, 'GET', `/api/booking/detail/${r[0].id}`))).status).toBe(404);
  });
});
