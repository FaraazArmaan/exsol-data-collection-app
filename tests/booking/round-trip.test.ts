// J — round-trip smoke: walk the whole module happy path through the real HTTP handlers.
// settings → resource → service → availability → public create → vendor list → manage →
// manual-create (past) → mark completed.
import { describe, it, expect, beforeAll } from 'vitest';
import settings from '../../netlify/functions/booking-settings';
import resources from '../../netlify/functions/booking-resources';
import services from '../../netlify/functions/booking-services';
import availability from '../../netlify/functions/booking-public-availability';
import publicCreate from '../../netlify/functions/booking-public-create';
import list from '../../netlify/functions/booking-list';
import manage from '../../netlify/functions/booking-public-manage';
import manual from '../../netlify/functions/booking-manual-create';
import detail from '../../netlify/functions/booking-detail';
import {
  seedClientWithBooking,
  enableBooking,
  seedCustomerRole,
  grantBookingPerms,
  bookingRequest,
  publicRequest,
  publishBooking,
} from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
const week = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    [{ open: '09:00', close: '18:00' }],
  ]),
);

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, [
    'booking.employees.view',
    'booking.employees.edit',
    'booking.customers.view',
    'booking.customers.edit',
    'booking.customers.create',
  ]);
});

describe('round-trip happy path', () => {
  it('walks settings → service → availability → create → list → manage → complete', async () => {
    // 1. settings (open every day)
    expect(
      (
        await settings(
          bookingRequest(ctx, 'PUT', '/api/booking/settings', {
            slot_interval_min: 30,
            lead_time_min: 0,
            cancel_cutoff_min: 60,
            weekly_schedule: week,
            date_overrides: [],
          }),
        )
      ).status,
    ).toBe(200);

    // 2. resource
    const res = await resources(
      bookingRequest(ctx, 'POST', '/api/booking/resources', { name: 'Sarah' }),
    );
    const resId = (await res.json()).id;

    // 3. service (pay_at_venue)
    const svc = await services(
      bookingRequest(ctx, 'POST', '/api/booking/services', {
        name: 'Cut',
        duration_min: 60,
        price_cents: 30000,
        eligible_resource_ids: [resId],
      }),
    );
    const serviceId = (await svc.json()).id;
    await publishBooking(ctx.clientId);

    // 4. availability (a future Wednesday)
    const date = '2031-06-04';
    const avail = await availability(
      publicRequest(
        ctx.slug,
        'GET',
        `/availability?service_id=${serviceId}&date=${date}&resource_id=any`,
      ),
    );
    const slots = (await avail.json()).slots;
    expect(slots.length).toBeGreaterThan(0);

    // 5. public create on the first slot
    const created = await publicCreate(
      publicRequest(ctx.slug, 'POST', '/create', {
        service_id: serviceId,
        resource_id: 'any',
        start: slots[0].start,
        customer: { name: 'Riya', phone: '98765 43210' },
      }),
    );
    expect(created.status).toBe(201);
    const { status, manage_token } = await created.json();
    expect(status).toBe('confirmed');

    // 6. vendor list shows it
    const listed = await list(
      bookingRequest(ctx, 'GET', `/api/booking/list?from=${date}&to=${date}`),
    );
    const bookings = (await listed.json()).bookings;
    expect(bookings.some((b: any) => b.status === 'confirmed')).toBe(true);

    // 7. customer manage link works
    const m = await manage(
      new Request(`http://localhost/api/booking-public/manage/${manage_token}`),
    );
    expect((await m.json()).cancellable).toBe(true);

    // 8. vendor manual-create a PAST booking, then mark it completed
    const past = await manual(
      bookingRequest(ctx, 'POST', '/api/booking/manual-create', {
        service_id: serviceId,
        resource_id: resId,
        start: '2020-06-04T09:00:00Z',
        customer: { name: 'Old', phone: '90000 00009' },
      }),
    );
    const pastId = (await past.json()).id;
    const done = await detail(
      bookingRequest(ctx, 'PATCH', `/api/booking/detail/${pastId}`, { action: 'complete' }),
    );
    expect((await done.json()).status).toBe('completed');
  });
});
