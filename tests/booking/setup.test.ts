import { beforeAll, describe, expect, it } from 'vitest';
import handler from '../../netlify/functions/booking-setup';
import {
  bookingRequest,
  enableBooking,
  grantBookingPerms,
  seedClientWithBooking,
} from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view', 'booking.employees.edit']);
});

describe('GET/PUT /api/booking/setup', () => {
  it('returns guided defaults before setup is completed', async () => {
    const res = await handler(bookingRequest(ctx, 'GET', '/api/booking/setup'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_first_visit).toBe(true);
    expect(body.visible_sections).toEqual([
      { key: 'team', label: 'Team Availability' },
      { key: 'rules', label: 'Booking Rules' },
    ]);
  });

  it('saves editable clinic answers and generates client labels', async () => {
    const res = await handler(
      bookingRequest(ctx, 'PUT', '/api/booking/setup', {
        booking_party_mode: 'specific_team_member',
        bookable_kinds: ['appointment', 'space', 'equipment'],
        extra_capacity_needs: ['space', 'equipment'],
        availability_source: 'workforce',
        display_labels: { team: 'Doctors', space: 'Rooms', equipment: 'Equipment' },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_first_visit).toBe(false);
    expect(body.visible_sections.map((section: { label: string }) => section.label)).toEqual([
      'Doctors',
      'Rooms',
      'Equipment',
      'Booking Rules',
    ]);

    const get = await handler(bookingRequest(ctx, 'GET', '/api/booking/setup'));
    expect((await get.json()).display_labels.team).toBe('Doctors');
  });

  it('rejects manual availability whenever customers book with a team member', async () => {
    const res = await handler(
      bookingRequest(ctx, 'PUT', '/api/booking/setup', {
        booking_party_mode: 'any_team_member',
        bookable_kinds: ['appointment'],
        extra_capacity_needs: [],
        availability_source: 'manual',
        display_labels: {},
      }),
    );
    expect(res.status).toBe(400);
  });
});
