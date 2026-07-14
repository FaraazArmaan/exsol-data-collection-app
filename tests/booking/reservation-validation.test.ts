import { beforeAll, describe, expect, it } from 'vitest';
import create from '../../netlify/functions/booking-public-create';
import manage from '../../netlify/functions/booking-public-manage';
import {
  enableBooking,
  makeService,
  publishBooking,
  publicRequest,
  seedClientWithBooking,
  seedCustomerRole,
  seedResource,
  setBookingSettings,
  sqlClient,
} from './_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let resourceId: string;
let serviceId: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  resourceId = await seedResource(ctx.clientId, 'Validator staff');
  serviceId = await makeService(ctx.clientId, {
    duration_min: 60,
    buffer_min: 30,
    eligible_resource_ids: [resourceId],
  });
  await setBookingSettings(
    ctx.clientId,
    { mon: [{ open: '09:00', close: '12:00' }] },
    { slot_interval_min: 30 },
  );
  await publishBooking(ctx.clientId);
});

function body(start: string, phone: string) {
  return {
    service_id: serviceId,
    resource_id: resourceId,
    start,
    customer: { name: 'Validator customer', phone },
  };
}

describe('authoritative reservation validation', () => {
  it('rejects a forged public request outside business hours', async () => {
    const response = await create(
      publicRequest(ctx.slug, 'POST', '/create', body('2026-08-17T07:30:00.000Z', '9000000101')),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('slot_unavailable');
  });

  it('enforces the prior booking buffer for forged public requests', async () => {
    expect(
      (
        await create(
          publicRequest(
            ctx.slug,
            'POST',
            '/create',
            body('2026-08-17T03:30:00.000Z', '9000000102'),
          ),
        )
      ).status,
    ).toBe(201);
    const response = await create(
      publicRequest(ctx.slug, 'POST', '/create', body('2026-08-17T04:30:00.000Z', '9000000103')),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('slot_taken');
  });

  it('applies the same availability rules to customer reschedule', async () => {
    const token = `reservation-${crypto.randomUUID()}`;
    await sql`
      INSERT INTO public.bookings
        (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name, manage_token)
      VALUES (
        ${ctx.clientId}::uuid, ${serviceId}::uuid, ${resourceId}::uuid, ${ctx.ownerNodeId}::uuid,
        '[2031-08-18T03:30:00Z,2031-08-18T04:30:00Z)'::tstzrange, 'confirmed', 'Customer', ${token}
      )
    `;
    const response = await manage(
      new Request(`http://localhost/api/booking-public/manage/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', start: '2031-08-18T07:30:00.000Z' }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('slot_unavailable');
  });

  it('rejects a forged public request outside an employee Workforce shift', async () => {
    const workforce = await seedClientWithBooking();
    await enableBooking(workforce.clientId);
    await seedCustomerRole(workforce.clientId);
    const staffResourceId = await seedResource(workforce.clientId, 'Workforce staff');
    const staffServiceId = await makeService(workforce.clientId, {
      duration_min: 60,
      eligible_resource_ids: [staffResourceId],
    });
    await setBookingSettings(
      workforce.clientId,
      { mon: [{ open: '09:00', close: '18:00' }] },
      { slot_interval_min: 30 },
    );
    await sql`
      INSERT INTO public.booking_setup
        (bucket_id, booking_party_mode, bookable_kinds, extra_capacity_needs, availability_source, completed_at, public_enabled)
      VALUES (${workforce.clientId}::uuid, 'specific_team_member', ARRAY['appointment']::text[], ARRAY[]::text[], 'workforce', now(), true)
    `;
    await sql`
      INSERT INTO public.workforce_employee_profiles (client_id, resource_id, legal_name)
      VALUES (${workforce.clientId}::uuid, ${staffResourceId}::uuid, 'Workforce staff')
    `;
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${workforce.clientId}::uuid, ${staffResourceId}::uuid, 1, '12:00'::time, '14:00'::time)
    `;

    const response = await create(
      publicRequest(workforce.slug, 'POST', '/create', {
        service_id: staffServiceId,
        resource_id: staffResourceId,
        start: '2026-08-17T03:30:00.000Z',
        customer: { name: 'Forged customer', phone: '9000000104' },
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('slot_unavailable');
  });
});
