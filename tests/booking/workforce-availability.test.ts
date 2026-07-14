import { describe, expect, it } from 'vitest';
import availability from '../../netlify/functions/booking-public-availability';
import publicResources from '../../netlify/functions/booking-public-resources';
import {
  enableBooking,
  makeService,
  publicRequest,
  seedClientWithBooking,
  seedResource,
  setBookingSettings,
  sqlClient,
} from './_helpers';

const sql = sqlClient();
const monday = '2026-08-17';

async function seedStaffBooking(status = 'active') {
  const ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  const resourceId = await seedResource(ctx.clientId, 'Dr Test');
  const serviceId = await makeService(ctx.clientId, {
    duration_min: 60,
    eligible_resource_ids: [resourceId],
  });
  await setBookingSettings(
    ctx.clientId,
    { mon: [{ open: '09:00', close: '18:00' }] },
    { slot_interval_min: 30 },
  );
  await sql`
    INSERT INTO public.booking_setup
      (bucket_id, booking_party_mode, bookable_kinds, extra_capacity_needs, availability_source, completed_at)
    VALUES (${ctx.clientId}::uuid, 'specific_team_member', ARRAY['appointment']::text[], ARRAY[]::text[], 'workforce', now())
  `;
  await sql`
    INSERT INTO public.workforce_employee_profiles (client_id, resource_id, legal_name, employment_status)
    VALUES (${ctx.clientId}::uuid, ${resourceId}::uuid, 'Dr Test', ${status})
  `;
  return { ...ctx, resourceId, serviceId };
}

function request(slug: string, serviceId: string, resourceId = 'any') {
  return publicRequest(
    slug,
    'GET',
    `/availability?service_id=${serviceId}&date=${monday}&resource_id=${resourceId}`,
  );
}

describe('Workforce-backed booking availability', () => {
  it('uses Workforce shifts immediately and ignores the legacy resource schedule', async () => {
    const ctx = await seedStaffBooking();
    const shift = (await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, 1, '09:00'::time, '11:00'::time)
      RETURNING id
    `) as Array<{ id: string }>;

    const before = await availability(request(ctx.slug, ctx.serviceId));
    expect((await before.json()).slots.map((slot: { start: string }) => slot.start)).toEqual([
      '2026-08-17T03:30:00.000Z',
      '2026-08-17T04:00:00.000Z',
      '2026-08-17T04:30:00.000Z',
    ]);

    await sql`DELETE FROM public.workforce_shifts WHERE id = ${shift[0]!.id}::uuid`;
    const after = await availability(request(ctx.slug, ctx.serviceId));
    expect((await after.json()).slots).toEqual([]);
  });

  it('removes an otherwise scheduled employee for approved leave', async () => {
    const ctx = await seedStaffBooking();
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, 1, '09:00'::time, '11:00'::time)
    `;
    await sql`
      INSERT INTO public.leave_requests (client_id, resource_id, leave_type, start_date, end_date, status)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, 'annual', ${monday}::date, ${monday}::date, 'approved')
    `;

    const response = await availability(request(ctx.slug, ctx.serviceId));
    expect((await response.json()).slots).toEqual([]);
  });

  it('does not expose terminated employees or another tenant resource', async () => {
    const inactive = await seedStaffBooking('terminated');
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${inactive.clientId}::uuid, ${inactive.resourceId}::uuid, 1, '09:00'::time, '11:00'::time)
    `;
    expect(
      (await (await availability(request(inactive.slug, inactive.serviceId))).json()).slots,
    ).toEqual([]);
    const staff = await publicResources(publicRequest(inactive.slug, 'GET', '/resources'));
    expect((await staff.json()).resources).toEqual([]);

    const other = await seedStaffBooking();
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${other.clientId}::uuid, ${other.resourceId}::uuid, 1, '09:00'::time, '11:00'::time)
    `;
    expect(
      (
        await (
          await availability(request(inactive.slug, inactive.serviceId, other.resourceId))
        ).json()
      ).slots,
    ).toEqual([]);
  });
});
