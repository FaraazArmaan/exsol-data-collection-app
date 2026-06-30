import { describe, it, expect, beforeAll } from 'vitest';
import services from '../../netlify/functions/booking-public-services';
import resources from '../../netlify/functions/booking-public-resources';
import { seedClientWithBooking, enableBooking, seedResource, makeService, publicRequest } from './_helpers';

let slug: string;
beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  slug = ctx.slug;
  await enableBooking(ctx.clientId);
  await seedResource(ctx.clientId, 'Priya');
  await makeService(ctx.clientId, { name: 'Public Cut', duration_min: 30, price_cents: 25000 });
});

describe('public catalogs (anonymous)', () => {
  it('unknown slug → 404', async () => {
    const r = await services(publicRequest('no-such-tenant', 'GET', '/services'));
    expect(r.status).toBe(404);
  });
  it('returns active services for a known slug', async () => {
    const r = await services(publicRequest(slug, 'GET', '/services'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.services.some((s: any) => s.name === 'Public Cut')).toBe(true);
  });
  it('returns active resources (name only)', async () => {
    const r = await resources(publicRequest(slug, 'GET', '/resources'));
    const body = await r.json();
    expect(body.resources.some((x: any) => x.name === 'Priya')).toBe(true);
    expect(Object.keys(body.resources[0])).toEqual(['id', 'name']);
  });
});
