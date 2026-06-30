import { describe, it, expect, beforeAll } from 'vitest';
import { requireBooking } from '../../netlify/functions/_booking-authz';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => { ctx = await seedClientWithBooking(); await enableBooking(ctx.clientId); });

describe('requireBooking', () => {
  it('401 when no cookie', async () => {
    const r = await requireBooking(new Request('http://x/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('403 when authed but missing the required key', async () => {
    const r = await requireBooking(bookingRequest(ctx, 'GET', '/api/booking/settings'), ['booking.employees.edit']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('ok when the key is granted', async () => {
    await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view']);
    const r = await requireBooking(bookingRequest(ctx, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(true);
  });

  it('412 when booking module not enabled', async () => {
    const fresh = await seedClientWithBooking(); // no enableBooking()
    const r = await requireBooking(bookingRequest(fresh, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(412);
  });
});
