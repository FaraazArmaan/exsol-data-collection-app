import { describe, expect, it } from 'vitest';
import policy from '../../netlify/functions/booking-policy';
import create from '../../netlify/functions/booking-public-create';
import manage from '../../netlify/functions/booking-public-manage';
import {
  bookingRequest,
  demoteToL2,
  enableBooking,
  grantBookingPerms,
  makeService,
  publicRequest,
  seedClientWithBooking,
  seedCustomerRole,
  seedResource,
  setBookingSettings,
  sqlClient,
} from './_helpers';

const sql = sqlClient();
const customPolicy = {
  cancel_cutoff_min: 300,
  reschedule_cutoff_min: 300,
  max_customer_reschedules: 1,
  late_arrival_grace_min: 10,
  no_show_outcome: 'staff_review' as const,
  cancellation_settlement: 'credit_deposit' as const,
  late_reschedule_action: 'staff_approval' as const,
  late_reschedule_fee_cents: 5000,
  deposit_requirement: 'service_defined' as const,
};

describe('booking policy', () => {
  it('returns defaults and versions editable workspace policy', async () => {
    const ctx = await seedClientWithBooking();
    await enableBooking(ctx.clientId);
    const initial = await policy(bookingRequest(ctx, 'GET', '/api/booking/policy'));
    expect(await initial.json()).toMatchObject({
      version: 1,
      cancel_cutoff_min: 1440,
      max_customer_reschedules: 3,
    });

    const first = await policy(bookingRequest(ctx, 'PUT', '/api/booking/policy', customPolicy));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ...customPolicy, version: 1 });

    const second = await policy(
      bookingRequest(ctx, 'PUT', '/api/booking/policy', {
        ...customPolicy,
        max_customer_reschedules: 2,
      }),
    );
    expect(await second.json()).toMatchObject({ version: 2, max_customer_reschedules: 2 });
  });

  it('requires booking rule edit permission to change a policy', async () => {
    const owner = await seedClientWithBooking();
    await enableBooking(owner.clientId);
    const viewer = await demoteToL2(owner);
    await grantBookingPerms(owner.clientId, 2, ['booking.employees.view']);
    const response = await policy(
      bookingRequest(viewer, 'PUT', '/api/booking/policy', customPolicy),
    );
    expect(response.status).toBe(403);
  });

  it('snapshots policy on a visit and enforces its customer reschedule limit', async () => {
    const ctx = await seedClientWithBooking();
    await enableBooking(ctx.clientId);
    await seedCustomerRole(ctx.clientId);
    const resourceId = await seedResource(ctx.clientId, 'Policy staff');
    const serviceId = await makeService(ctx.clientId, {
      name: 'Policy service',
      duration_min: 30,
      eligible_resource_ids: [resourceId],
    });
    await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '12:00' }] });
    await policy(bookingRequest(ctx, 'PUT', '/api/booking/policy', customPolicy));

    const created = await create(
      publicRequest(ctx.slug, 'POST', '/create', {
        service_id: serviceId,
        resource_id: resourceId,
        start: '2026-08-17T03:30:00.000Z',
        customer: { name: 'Policy customer', phone: '9000000301' },
      }),
    );
    expect(created.status).toBe(201);
    const booking = await created.json();

    await policy(
      bookingRequest(ctx, 'PUT', '/api/booking/policy', {
        ...customPolicy,
        max_customer_reschedules: 5,
      }),
    );
    const visits = (await sql`
      SELECT policy_snapshot FROM public.booking_visits WHERE id = ${booking.visit_id}::uuid
    `) as Array<{ policy_snapshot: { max_customer_reschedules: number; version: number } }>;
    expect(visits[0]!.policy_snapshot).toMatchObject({ version: 1, max_customer_reschedules: 1 });

    const firstMove = await manage(
      new Request(`http://localhost/api/booking-public/manage/${booking.manage_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', start: '2026-08-17T04:30:00.000Z' }),
      }),
    );
    expect(firstMove.status).toBe(200);
    const secondMove = await manage(
      new Request(`http://localhost/api/booking-public/manage/${booking.manage_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', start: '2026-08-17T05:30:00.000Z' }),
      }),
    );
    expect(secondMove.status).toBe(409);
    expect((await secondMove.json()).error.code).toBe('reschedule_limit_reached');
  });
});
