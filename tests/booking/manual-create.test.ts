import { describe, it, expect, beforeAll } from 'vitest';
import manual from '../../netlify/functions/booking-manual-create';
import { seedClientWithBooking, enableBooking, grantBookingPerms, seedResource, seedCustomerRole, makeService, bookingRequest, demoteToL2 } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let resId: string, svc: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.customers.create']);
  resId = await seedResource(ctx.clientId, 'Sarah');
  svc = await makeService(ctx.clientId, { duration_min: 60 });
});

describe('POST /api/booking/manual-create', () => {
  it('creates a confirmed booking off-grid (any minute)', async () => {
    const r = await manual(bookingRequest(ctx, 'POST', '/api/booking/manual-create', {
      service_id: svc, resource_id: resId, start: '2031-03-03T09:13:00.000Z',
      customer: { name: 'Walk In', phone: '98765 00000' },
    }));
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe('confirmed');
  });

  it('creates a blocked staff-time window (no customer/service)', async () => {
    const r = await manual(bookingRequest(ctx, 'POST', '/api/booking/manual-create', {
      blocked: true, resource_id: resId, start: '2031-03-04T06:00:00Z', end: '2031-03-04T07:00:00Z',
    }));
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe('blocked');
  });

  it('overlapping manual booking → 409 slot_taken', async () => {
    const slot = { service_id: svc, resource_id: resId, start: '2031-03-05T09:00:00.000Z',
      customer: { name: 'A', phone: '90000 00001' } };
    expect((await manual(bookingRequest(ctx, 'POST', '/api/booking/manual-create', slot))).status).toBe(201);
    const dup = await manual(bookingRequest(ctx, 'POST', '/api/booking/manual-create',
      { ...slot, customer: { name: 'B', phone: '90000 00002' } }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('slot_taken');
  });

  it('403 when L2 lacks booking.customers.create (view-only grant)', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const sub = await demoteToL2(owner);
    await grantBookingPerms(sub.clientId, 2, ['booking.customers.view']); // view-only, no create
    const subRes = await seedResource(sub.clientId);
    const subSvc = await makeService(sub.clientId);
    const r = await manual(bookingRequest(sub, 'POST', '/api/booking/manual-create',
      { service_id: subSvc, resource_id: subRes, start: '2031-03-06T09:00:00Z', customer: { name: 'X', phone: '9' } }));
    expect(r.status).toBe(403);
  });
});
