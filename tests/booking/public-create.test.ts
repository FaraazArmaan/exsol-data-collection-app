import { describe, it, expect, beforeAll } from 'vitest';
import create from '../../netlify/functions/booking-public-create';
import {
  seedClientWithBooking,
  enableBooking,
  seedResource,
  seedCustomerRole,
  makeService,
  publishBooking,
  setBookingSettings,
  publicRequest,
} from './_helpers';

let slug: string, clientId: string, resId: string, payService: string, depositService: string;

beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  slug = ctx.slug;
  clientId = ctx.clientId;
  await enableBooking(clientId);
  await seedCustomerRole(clientId);
  resId = await seedResource(clientId, 'Sarah');
  await setBookingSettings(
    clientId,
    { mon: [{ open: '09:00', close: '18:00' }] },
    { slot_interval_min: 30 },
  );
  payService = await makeService(clientId, {
    name: 'Cut',
    duration_min: 60,
    payment_mode: 'pay_at_venue',
    eligible_resource_ids: [resId],
  });
  depositService = await makeService(clientId, {
    name: 'Color',
    duration_min: 60,
    price_cents: 50000,
    payment_mode: 'deposit',
    deposit_cents: 10000,
    eligible_resource_ids: [resId],
  });
  await publishBooking(clientId);
});

const body = (service: string, start: string, i = 0) => ({
  service_id: service,
  resource_id: 'any',
  start,
  customer: { name: `C${i}`, phone: `9000000${String(i).padStart(3, '0')}` },
});

describe('POST public create', () => {
  it('pay_at_venue → 201 confirmed + manage_token', async () => {
    const r = await create(
      publicRequest(slug, 'POST', '/create', body(payService, '2026-08-17T05:00:00.000Z')),
    );
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.status).toBe('confirmed');
    expect(j.manage_token).toBeTruthy();
    expect(j.payment_intent).toBeUndefined();
  });

  it('named resource booked twice on an overlapping slot → 409 slot_taken (gist 23P01)', async () => {
    const start = '2026-08-17T06:00:00.000Z';
    const named = (i: number) => ({
      service_id: payService,
      resource_id: resId,
      start,
      customer: { name: `N${i}`, phone: `9111111${String(i).padStart(3, '0')}` },
    });
    const first = await create(publicRequest(slug, 'POST', '/create', named(1)));
    expect(first.status).toBe(201);
    const second = await create(publicRequest(slug, 'POST', '/create', named(2)));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('slot_taken');
  });

  it('"any" with the only resource busy → 409 no_resource_available (pre-check)', async () => {
    const start = '2026-08-17T11:00:00.000Z';
    expect(
      (await create(publicRequest(slug, 'POST', '/create', body(payService, start, 8)))).status,
    ).toBe(201);
    const second = await create(publicRequest(slug, 'POST', '/create', body(payService, start, 9)));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('no_resource_available');
  });

  it('deposit service without a tenant Test-mode connection → 409', async () => {
    const r = await create(
      publicRequest(slug, 'POST', '/create', body(depositService, '2026-08-17T08:00:00.000Z', 3)),
    );
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error.code).toBe('online_payment_unavailable');
  });

  it('honeypot: a filled hp field is rejected as a bot → 400', async () => {
    const r = await create(
      publicRequest(slug, 'POST', '/create', {
        ...body(payService, '2026-08-17T12:00:00.000Z', 7),
        hp: 'http://spam.example',
      }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('invalid_request');
  });
});
