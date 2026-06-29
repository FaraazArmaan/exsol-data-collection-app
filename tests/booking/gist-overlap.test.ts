// Proves the no-overbook guarantee: the bookings_no_overlap gist EXCLUDE
// constraint rejects overlapping live bookings on the same resource, while
// allowing adjacent (touching) ranges and cancelled bookings.
//
// ⚠️ Requires DATABASE_URL with migrations 043–044 applied (currently unapplied
//    pending numbering coordination). Until then this suite cannot run green.

import { describe, it, expect, beforeAll } from 'vitest';
import { sqlClient, seedClientWithBooking, seedResource } from './_helpers';

const sql = sqlClient();
let clientId: string, resourceId: string, serviceId: string, nodeId: string;

beforeAll(async () => {
  const c = await seedClientWithBooking();
  clientId = c.clientId; nodeId = c.ownerNodeId;
  resourceId = await seedResource(clientId);
  const svc = (await sql`
    INSERT INTO public.booking_services (bucket_id, name, duration_min, price_cents)
    VALUES (${clientId}, 'Color', 60, 50000) RETURNING id`) as Array<{ id: string }>;
  serviceId = svc[0]!.id;
});

async function insertBooking(range: string, status = 'confirmed') {
  return sql`
    INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
    VALUES (${clientId}, ${serviceId}, ${resourceId}, ${nodeId}, ${range}::tstzrange, ${status}, 'X')
    RETURNING id`;
}

describe('bookings_no_overlap (gist EXCLUDE)', () => {
  it('accepts the first booking', async () => {
    const r = await insertBooking('[2026-08-17T09:00:00Z,2026-08-17T10:00:00Z)');
    expect((r as unknown[]).length).toBe(1);
  });

  it('rejects an overlapping booking on the same resource (23P01)', async () => {
    await expect(insertBooking('[2026-08-17T09:30:00Z,2026-08-17T10:30:00Z)'))
      .rejects.toMatchObject({ code: '23P01' });
  });

  it('accepts an adjacent, non-overlapping booking (touching boundary)', async () => {
    const r = await insertBooking('[2026-08-17T10:00:00Z,2026-08-17T11:00:00Z)');
    expect((r as unknown[]).length).toBe(1);
  });

  it('lets a cancelled booking overlap (outside the predicate)', async () => {
    const r = await insertBooking('[2026-08-17T09:15:00Z,2026-08-17T09:45:00Z)', 'cancelled');
    expect((r as unknown[]).length).toBe(1);
  });

  it('blocked staff-time still occupies the slot (rejects overlap)', async () => {
    await sql`
      INSERT INTO public.bookings (bucket_id, resource_id, time_range, status)
      VALUES (${clientId}, ${resourceId}, '[2026-08-18T09:00:00Z,2026-08-18T12:00:00Z)'::tstzrange, 'blocked')`;
    await expect(insertBooking('[2026-08-18T10:00:00Z,2026-08-18T11:00:00Z)'))
      .rejects.toMatchObject({ code: '23P01' });
  });
});
