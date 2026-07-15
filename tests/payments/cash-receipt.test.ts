import { beforeAll, describe, expect, it } from 'vitest';
import cashReceipt from '../../netlify/functions/payments-cash-receipt';
import create from '../../netlify/functions/booking-public-create';
import {
  bookingRequest, enableBooking, makeService, publicRequest, publishBooking,
  seedClientWithBooking, seedCustomerRole, seedResource, setBookingSettings, sqlClient,
} from '../booking/_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let visitId: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  const resourceId = await seedResource(ctx.clientId, 'Payments cash staff');
  const serviceId = await makeService(ctx.clientId, { name: 'Payments cash service', price_cents: 1200, eligible_resource_ids: [resourceId] });
  await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '12:00' }] });
  await publishBooking(ctx.clientId);
  const response = await create(publicRequest(ctx.slug, 'POST', '/create', {
    service_id: serviceId, resource_id: resourceId, start: '2026-08-24T03:30:00.000Z',
    customer: { name: 'Payments Cash Customer', phone: `91${Math.random().toString().slice(2, 12)}` },
  }));
  expect(response.status).toBe(201);
  visitId = (await response.json()).visit_id;
});

describe('POST /api/payments/cash-receipts', () => {
  it('writes partial and final cash receipts without over-allocation', async () => {
    const first = await cashReceipt(bookingRequest(ctx, 'POST', '/api/payments/cash-receipts', { visit_id: visitId, amount_minor: 400, reference: 'drawer-a' }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ payment_status: 'partly_paid', paid_minor: 400 });

    const second = await cashReceipt(bookingRequest(ctx, 'POST', '/api/payments/cash-receipts', { visit_id: visitId, amount_minor: 800, reference: 'drawer-b' }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ payment_status: 'paid', paid_minor: 1200 });

    const excess = await cashReceipt(bookingRequest(ctx, 'POST', '/api/payments/cash-receipts', { visit_id: visitId, amount_minor: 1 }));
    expect(excess.status).toBe(409);

    const rows = await sql`
      SELECT (SELECT count(*)::int FROM public.payment_transactions WHERE client_id = ${ctx.clientId}::uuid) AS transactions,
             (SELECT count(*)::int FROM public.payment_allocations WHERE client_id = ${ctx.clientId}::uuid) AS allocations
    ` as Array<{ transactions: number; allocations: number }>;
    expect(rows[0]).toEqual({ transactions: 2, allocations: 2 });
  });
});
