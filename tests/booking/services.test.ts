import { describe, it, expect, beforeAll } from 'vitest';
import list from '../../netlify/functions/booking-services';
import detail from '../../netlify/functions/booking-service-detail';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view', 'booking.employees.edit']);
});

describe('booking services CRUD', () => {
  it('creates then lists a service', async () => {
    const c = await list(bookingRequest(ctx, 'POST', '/api/booking/services',
      { name: 'Haircut', duration_min: 30, price_cents: 20000 }));
    expect(c.status).toBe(201);
    const created = await c.json();
    expect(created.payment_mode).toBe('pay_at_venue');

    const l = await list(bookingRequest(ctx, 'GET', '/api/booking/services'));
    const body = await l.json();
    expect(body.services.some((s: any) => s.id === created.id)).toBe(true);
  });

  it('rejects deposit mode without deposit_cents (400)', async () => {
    const r = await list(bookingRequest(ctx, 'POST', '/api/booking/services',
      { name: 'Color', duration_min: 60, price_cents: 50000, payment_mode: 'deposit' }));
    expect(r.status).toBe(400);
  });

  it('patches a service; cross-tenant id → 404', async () => {
    const c = await list(bookingRequest(ctx, 'POST', '/api/booking/services',
      { name: 'Spa', duration_min: 90, price_cents: 80000 }));
    const id = (await c.json()).id;
    const p = await detail(bookingRequest(ctx, 'PATCH', `/api/booking/service-detail/${id}`, { price_cents: 75000 }));
    expect(p.status).toBe(200);
    expect((await p.json()).price_cents).toBe('75000');

    const other = await seedClientWithBooking(); await enableBooking(other.clientId);
    await grantBookingPerms(other.clientId, 1, ['booking.employees.view']);
    const x = await detail(bookingRequest(other, 'GET', `/api/booking/service-detail/${id}`));
    expect(x.status).toBe(404);
  });

  it('soft-deletes (deactivates) a service', async () => {
    const c = await list(bookingRequest(ctx, 'POST', '/api/booking/services',
      { name: 'Temp', duration_min: 15, price_cents: 10000 }));
    const id = (await c.json()).id;
    const d = await detail(bookingRequest(ctx, 'DELETE', `/api/booking/service-detail/${id}`));
    expect(d.status).toBe(200);
    expect((await d.json()).active).toBe(false);
  });
});
