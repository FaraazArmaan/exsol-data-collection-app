import { beforeAll, describe, expect, it } from 'vitest';
import detail from '../../netlify/functions/booking-detail';
import create from '../../netlify/functions/booking-public-create';
import manage from '../../netlify/functions/booking-public-manage';
import {
  bookingRequest,
  enableBooking,
  makeService,
  publicRequest,
  seedClientWithBooking,
  seedCustomerRole,
  seedResource,
  setBookingSettings,
  sqlClient,
} from './_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let bookingId: string;
let visitId: string;
let manageToken: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  const resourceId = await seedResource(ctx.clientId, 'Lifecycle staff');
  const serviceId = await makeService(ctx.clientId, {
    name: 'Lifecycle service',
    duration_min: 30,
    price_cents: 12000,
    eligible_resource_ids: [resourceId],
  });
  await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '12:00' }] });
  const response = await create(
    publicRequest(ctx.slug, 'POST', '/create', {
      service_id: serviceId,
      resource_id: resourceId,
      start: '2026-08-17T03:30:00.000Z',
      customer: { name: 'Lifecycle customer', phone: '9000000401' },
    }),
  );
  expect(response.status).toBe(201);
  const created = await response.json();
  bookingId = created.booking_id;
  visitId = created.visit_id;
  manageToken = created.manage_token;
});

describe('booking lifecycle events', () => {
  it('returns the visit services and policy for customer self-service', async () => {
    const response = await manage(
      new Request(`http://localhost/api/booking-public/manage/${manageToken}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.services).toHaveLength(1);
    expect(body.policy).toMatchObject({ max_customer_reschedules: 3 });
  });

  it('keeps cash payment state separate from the confirmed appointment', async () => {
    const visits = (await sql`
      SELECT status, payment_status FROM public.booking_visits WHERE id = ${visitId}::uuid
    `) as Array<{ status: string; payment_status: string }>;
    expect(visits[0]).toEqual({ status: 'confirmed', payment_status: 'cash_pending' });

    const response = await detail(
      bookingRequest(ctx, 'PATCH', `/api/booking/detail/${bookingId}`, {
        action: 'record_cash_payment',
        reference: 'cash-desk-1',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
  });

  it('records customer reschedule and vendor completion in chronological history', async () => {
    const moved = await manage(
      new Request(`http://localhost/api/booking-public/manage/${manageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', start: '2026-08-17T04:30:00.000Z' }),
      }),
    );
    expect(moved.status).toBe(200);
    const checkedIn = await detail(
      bookingRequest(ctx, 'PATCH', `/api/booking/detail/${bookingId}`, { action: 'check_in' }),
    );
    expect(checkedIn.status).toBe(200);

    await sql`
      UPDATE public.booking_visits
      SET time_range = tstzrange('2026-01-05T03:30:00.000Z'::timestamptz, '2026-01-05T04:00:00.000Z'::timestamptz)
      WHERE id = ${visitId}::uuid
    `;
    await sql`
      UPDATE public.bookings
      SET time_range = tstzrange('2026-01-05T03:30:00.000Z'::timestamptz, '2026-01-05T04:00:00.000Z'::timestamptz)
      WHERE id = ${bookingId}::uuid
    `;
    const completed = await detail(
      bookingRequest(ctx, 'PATCH', `/api/booking/detail/${bookingId}`, { action: 'complete' }),
    );
    expect(completed.status).toBe(200);

    const read = await detail(bookingRequest(ctx, 'GET', `/api/booking/detail/${bookingId}`));
    const body = await read.json();
    expect(body.payment_status).toBe('paid');
    expect(body.events.map((event: { event_type: string }) => event.event_type)).toEqual(
      expect.arrayContaining([
        'visit_created',
        'offline_cash_received',
        'visit_rescheduled',
        'visit_checked_in',
        'visit_completed',
      ]),
    );
  });

  it('does not allow booking history to be updated or deleted', async () => {
    const events = (await sql`
      SELECT id FROM public.booking_events WHERE visit_id = ${visitId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    await expect(sql`
      UPDATE public.booking_events SET reason = 'changed' WHERE id = ${events[0]!.id}::uuid
    `).rejects.toThrow('append-only');
  });
});
