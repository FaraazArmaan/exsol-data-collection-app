import { beforeAll, describe, expect, it } from 'vitest';
import availability from '../../netlify/functions/booking-public-availability';
import create from '../../netlify/functions/booking-public-create';
import manage from '../../netlify/functions/booking-public-manage';
import {
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
let resourceId: string;
let firstServiceId: string;
let secondServiceId: string;
let visitId: string;
let manageToken: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  resourceId = await seedResource(ctx.clientId, 'Sequential staff');
  await setBookingSettings(
    ctx.clientId,
    { mon: [{ open: '09:00', close: '12:00' }] },
    { slot_interval_min: 30 },
  );
  firstServiceId = await makeService(ctx.clientId, {
    name: 'Cut',
    duration_min: 30,
    buffer_min: 10,
    price_cents: 10000,
    eligible_resource_ids: [resourceId],
  });
  secondServiceId = await makeService(ctx.clientId, {
    name: 'Trim',
    duration_min: 20,
    price_cents: 5000,
    eligible_resource_ids: [resourceId],
  });
});

describe('sequential booking visits', () => {
  it('returns a combined visit slot and creates one visit with two lines and reservations', async () => {
    const slots = await availability(
      publicRequest(
        ctx.slug,
        'GET',
        `/availability?service_ids=${firstServiceId},${secondServiceId}&date=2026-08-17&resource_id=${resourceId}`,
      ),
    );
    const available = await slots.json();
    expect(available.slots[0]).toMatchObject({
      start: '2026-08-17T03:30:00.000Z',
      end: '2026-08-17T04:30:00.000Z',
      resource_id: resourceId,
    });

    const response = await create(
      publicRequest(ctx.slug, 'POST', '/create', {
        service_ids: [firstServiceId, secondServiceId],
        resource_id: resourceId,
        start: available.slots[0].start,
        customer: { name: 'Visit customer', phone: '9000000201' },
      }),
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.visit_id).toBeTruthy();
    visitId = created.visit_id;
    manageToken = created.manage_token;

    const lines = (await sql`
      SELECT sequence_number, lower(time_range) AS start_at, upper(time_range) AS end_at, price_cents
      FROM public.booking_appointment_lines
      WHERE visit_id = ${created.visit_id}::uuid
      ORDER BY sequence_number
    `) as Array<{ sequence_number: number; start_at: string; end_at: string; price_cents: number }>;
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.sequence_number)).toEqual([1, 2]);
    expect(new Date(lines[0]!.end_at).toISOString()).toBe('2026-08-17T04:00:00.000Z');
    expect(new Date(lines[1]!.start_at).toISOString()).toBe('2026-08-17T04:10:00.000Z');
    const reservations = (await sql`
      SELECT upper(r.time_range) AS end_at
      FROM public.booking_line_reservations r
      JOIN public.booking_appointment_lines l ON l.id = r.appointment_line_id
      WHERE r.visit_id = ${created.visit_id}::uuid
      ORDER BY l.sequence_number
    `) as Array<{ end_at: string }>;
    expect(reservations).toHaveLength(2);
    expect(new Date(reservations[0]!.end_at).toISOString()).toBe('2026-08-17T04:10:00.000Z');
  });

  it('prevents another visit from overlapping either appointment line', async () => {
    const response = await create(
      publicRequest(ctx.slug, 'POST', '/create', {
        service_id: firstServiceId,
        resource_id: resourceId,
        start: '2026-08-17T04:00:00.000Z',
        customer: { name: 'Overlapping customer', phone: '9000000202' },
      }),
    );
    expect(response.status).toBe(409);
  });

  it('reschedules every line sequentially through the customer manage link', async () => {
    const response = await manage(
      new Request(`http://localhost/api/booking-public/manage/${manageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', start: '2026-08-17T05:00:00.000Z' }),
      }),
    );
    expect(response.status).toBe(200);
    const lines = (await sql`
      SELECT lower(time_range) AS start_at, upper(time_range) AS end_at
      FROM public.booking_appointment_lines
      WHERE visit_id = ${visitId}::uuid
      ORDER BY sequence_number
    `) as Array<{ start_at: string; end_at: string }>;
    expect(new Date(lines[0]!.start_at).toISOString()).toBe('2026-08-17T05:00:00.000Z');
    expect(new Date(lines[0]!.end_at).toISOString()).toBe('2026-08-17T05:30:00.000Z');
    expect(new Date(lines[1]!.start_at).toISOString()).toBe('2026-08-17T05:40:00.000Z');
  });

  it('cancels the parent visit and releases every line reservation', async () => {
    const response = await manage(
      new Request(`http://localhost/api/booking-public/manage/${manageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      }),
    );
    expect(response.status).toBe(200);
    const rows = (await sql`
      SELECT status FROM public.booking_line_reservations WHERE visit_id = ${visitId}::uuid
    `) as Array<{ status: string }>;
    expect(rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
  });
});
