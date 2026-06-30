import { describe, it, expect, beforeAll } from 'vitest';
import resources from '../../netlify/functions/booking-resources';
import resourceDetail from '../../netlify/functions/booking-resource-detail';
import timeOff from '../../netlify/functions/booking-resource-time-off';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view', 'booking.employees.edit']);
});

describe('booking resources + time-off', () => {
  it('creates a resource, lists it, patches the name', async () => {
    const c = await resources(bookingRequest(ctx, 'POST', '/api/booking/resources', { name: 'Sarah' }));
    expect(c.status).toBe(201);
    const id = (await c.json()).id;
    const l = await resources(bookingRequest(ctx, 'GET', '/api/booking/resources'));
    expect((await l.json()).resources.some((r: any) => r.id === id)).toBe(true);
    const p = await resourceDetail(bookingRequest(ctx, 'PATCH', `/api/booking/resource-detail/${id}`, { name: 'Sarah K' }));
    expect((await p.json()).name).toBe('Sarah K');
  });

  it('adds + lists + deletes a time-off window; cross-tenant resource → 404', async () => {
    const c = await resources(bookingRequest(ctx, 'POST', '/api/booking/resources', { name: 'John' }));
    const resId = (await c.json()).id;
    const add = await timeOff(bookingRequest(ctx, 'POST', '/api/booking/resource-time-off',
      { resource_id: resId, starts_at: '2026-08-20T00:00:00Z', ends_at: '2026-08-21T00:00:00Z', reason: 'vacation' }));
    expect(add.status).toBe(201);
    const toId = (await add.json()).id;

    const list = await timeOff(bookingRequest(ctx, 'GET', `/api/booking/resource-time-off?resource_id=${resId}`));
    expect((await list.json()).time_off).toHaveLength(1);

    const del = await timeOff(bookingRequest(ctx, 'DELETE', `/api/booking/resource-time-off?id=${toId}`));
    expect(del.status).toBe(200);

    const other = await seedClientWithBooking(); await enableBooking(other.clientId);
    await grantBookingPerms(other.clientId, 1, ['booking.employees.view']);
    const x = await timeOff(bookingRequest(other, 'GET', `/api/booking/resource-time-off?resource_id=${resId}`));
    expect(x.status).toBe(404);
  });
});
