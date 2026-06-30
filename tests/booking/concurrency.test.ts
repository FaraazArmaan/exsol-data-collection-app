import { describe, it, expect, beforeAll } from 'vitest';
import create from '../../netlify/functions/booking-public-create';
import { seedClientWithBooking, enableBooking, seedResource, seedCustomerRole, makeService, setBookingSettings, publicRequest } from './_helpers';

let slug: string, serviceId: string;

beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  slug = ctx.slug;
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  const resId = await seedResource(ctx.clientId, 'Solo');
  await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '18:00' }] }, { slot_interval_min: 30 });
  serviceId = await makeService(ctx.clientId, { name: 'Color', duration_min: 60, eligible_resource_ids: [resId] });
});

describe('no-overbook under concurrency', () => {
  it('10 parallel creates for the same slot → exactly one 201, nine 409', async () => {
    const start = '2026-08-17T09:00:00.000Z';
    const body = (i: number) => ({
      service_id: serviceId, resource_id: 'any', start,
      customer: { name: `C${i}`, phone: `9${String(i).padStart(9, '0')}` }, // distinct phones → distinct customers
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(publicRequest(slug, 'POST', '/create', body(i)))),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });
});
