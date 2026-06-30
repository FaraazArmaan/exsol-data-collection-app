import { describe, it, expect, beforeAll } from 'vitest';
import availability from '../../netlify/functions/booking-public-availability';
import { sqlClient, seedClientWithBooking, enableBooking, seedResource, makeService, setBookingSettings, publicRequest } from './_helpers';

const sql = sqlClient();
let slug: string, clientId: string, resId: string, serviceId: string;

beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  slug = ctx.slug; clientId = ctx.clientId;
  await enableBooking(clientId);
  resId = await seedResource(clientId, 'Sarah');
  await setBookingSettings(clientId, { mon: [{ open: '09:00', close: '11:00' }] }, { slot_interval_min: 30 });
  serviceId = await makeService(clientId, { duration_min: 60, eligible_resource_ids: [resId] });
});

function q(date: string, resource = 'any') {
  return publicRequest(slug, 'GET', `/availability?service_id=${serviceId}&date=${date}&resource_id=${resource}`);
}

describe('public availability', () => {
  it('invalid query → 400; unknown service → 404', async () => {
    expect((await availability(publicRequest(slug, 'GET', '/availability?service_id=x&date=bad'))).status).toBe(400);
    const r = await availability(publicRequest(slug, 'GET', `/availability?service_id=${crypto.randomUUID()}&date=2026-08-17&resource_id=any`));
    expect(r.status).toBe(404);
  });

  it('mon 09–11, 60-min service, 30-min grid → 3 starts (IST→UTC)', async () => {
    const r = await availability(q('2026-08-17')); // a Monday
    const starts = (await r.json()).slots.map((s: any) => s.start);
    expect(starts).toEqual([
      '2026-08-17T03:30:00.000Z', // 09:00 IST
      '2026-08-17T04:00:00.000Z', // 09:30
      '2026-08-17T04:30:00.000Z', // 10:00
    ]);
  });

  it('a blocked window removes overlapping starts, keeps the touching one', async () => {
    // blocked 09:00–10:00 IST = 03:30–04:30 UTC → removes 09:00 & 09:30; 10:00 (04:30) only touches → kept.
    await sql`INSERT INTO public.bookings (bucket_id, resource_id, time_range, status)
      VALUES (${clientId}, ${resId}, '[2026-08-17T03:30:00Z,2026-08-17T04:30:00Z)'::tstzrange, 'blocked')`;
    const r = await availability(q('2026-08-17'));
    const starts = (await r.json()).slots.map((s: any) => s.start);
    expect(starts).toEqual(['2026-08-17T04:30:00.000Z']);
  });

  it('closed weekday → no slots', async () => {
    const r = await availability(q('2026-08-18')); // Tuesday, no schedule
    expect((await r.json()).slots).toEqual([]);
  });
});
