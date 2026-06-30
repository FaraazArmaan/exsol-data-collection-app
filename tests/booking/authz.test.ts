import { describe, it, expect, beforeAll } from 'vitest';
import { requireBooking } from '../../netlify/functions/_booking-authz';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest, demoteToL2 } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => { ctx = await seedClientWithBooking(); await enableBooking(ctx.clientId); });

describe('requireBooking', () => {
  it('401 when no cookie', async () => {
    const r = await requireBooking(new Request('http://x/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('403 when L2 user is authed but missing the required key', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const sub = await demoteToL2(owner);
    const r = await requireBooking(bookingRequest(sub, 'GET', '/api/booking/settings'), ['booking.employees.edit']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it('ok when the key is granted (L2 via explicit grant)', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const sub = await demoteToL2(owner);
    await grantBookingPerms(sub.clientId, 2, ['booking.employees.view']);
    const r = await requireBooking(bookingRequest(sub, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(true);
  });

  it('L1 Owner is all-on without any explicit grants', async () => {
    const fresh = await seedClientWithBooking();
    await enableBooking(fresh.clientId);
    // No demoteToL2 + no grants — L1 with empty matrix should still pass the gate.
    const r = await requireBooking(bookingRequest(fresh, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.perms.has('booking.customers.view')).toBe(true);
  });

  it('412 when booking module not enabled', async () => {
    const fresh = await seedClientWithBooking(); // no enableBooking()
    const r = await requireBooking(bookingRequest(fresh, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(412);
  });
});
