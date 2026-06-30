import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/booking-settings';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest, demoteToL2 } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view', 'booking.employees.edit']);
});

describe('GET/PUT /api/booking/settings', () => {
  it('GET returns defaults before any PUT', async () => {
    const res = await handler(bookingRequest(ctx, 'GET', '/api/booking/settings'));
    expect(res.status).toBe(200);
    expect((await res.json()).slot_interval_min).toBe(15);
  });

  it('PUT upserts then GET returns it', async () => {
    const put = await handler(bookingRequest(ctx, 'PUT', '/api/booking/settings', {
      slot_interval_min: 30, lead_time_min: 60, cancel_cutoff_min: 120,
      weekly_schedule: { mon: [{ open: '09:00', close: '17:00' }] }, date_overrides: [],
    }));
    expect(put.status).toBe(200);
    const get = await handler(bookingRequest(ctx, 'GET', '/api/booking/settings'));
    const body = await get.json();
    expect(body.slot_interval_min).toBe(30);
    expect(body.weekly_schedule.mon[0].close).toBe('17:00');
  });

  it('PUT without edit perm → 403 (L2 with view-only grant)', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const sub = await demoteToL2(owner);
    await grantBookingPerms(sub.clientId, 2, ['booking.employees.view']); // view only, no edit
    const r = await handler(bookingRequest(sub, 'PUT', '/api/booking/settings', {
      slot_interval_min: 15, weekly_schedule: {}, date_overrides: [],
    }));
    expect(r.status).toBe(403);
  });
});
