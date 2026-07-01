import { describe, it, expect, beforeAll } from 'vitest';
import bookingsHandler from '../../netlify/functions/analytics-bookings';
import customersHandler from '../../netlify/functions/analytics-customers';
import teamHandler from '../../netlify/functions/analytics-team';
import catalogHandler from '../../netlify/functions/analytics-catalog';
import { seedPaidSales } from './_analytics-helpers';
import { seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';
import { seedClientWithBooking, seedResource, makeService, grantBookingPerms } from '../booking/_helpers';
import { sqlClient } from '../booking/_helpers';

const FROM = '2026-01-05';
const TO = '2026-01-05';
const WHEN = `${FROM}T10:00:00Z`;
const req = (ctx: any, path: string) => makeBucketUserRequest(ctx, 'GET', path);
const kpiVal = (body: any, id: string) => body.kpis.find((k: any) => k.id === id)?.value;

describe('analytics-customers', () => {
  let ctx: Awaited<ReturnType<typeof seedPaidSales>>;
  beforeAll(async () => {
    // two orders from phone 90, one from 91 → 2 customers, 1 returning
    ctx = await seedPaidSales({ when: [WHEN, WHEN, WHEN], channel: ['instore', 'instore', 'instore'], priceCents: 1000 });
    const sql = sqlClient();
    // Force two of the three onto the same phone so "returning" is exercised.
    await sql`UPDATE public.sales SET customer_phone = '90' WHERE bucket_id = ${ctx.clientId} AND order_no IN (1,2)`;
    await sql`UPDATE public.sales SET customer_phone = '91' WHERE bucket_id = ${ctx.clientId} AND order_no = 3`;
  });
  it('counts distinct + returning customers', async () => {
    const res = await customersHandler(req(ctx, `/api/analytics-customers?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(kpiVal(body, 'customers')).toBe(2);
    expect(kpiVal(body, 'returning')).toBe(1);
  });
  it('403 without analytics.customers.view', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']); // wrong bucket
    const res = await customersHandler(req(sub, `/api/analytics-customers?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(403);
  });
});

describe('analytics-team', () => {
  let ctx: Awaited<ReturnType<typeof seedPaidSales>>;
  beforeAll(async () => {
    ctx = await seedPaidSales({ when: [WHEN, WHEN], channel: ['instore', 'instore'], priceCents: 1000 });
  });
  it('reports team members + staff sales', async () => {
    const res = await teamHandler(req(ctx, `/api/analytics-team?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(kpiVal(body, 'team_members')).toBeGreaterThanOrEqual(1);
    expect(kpiVal(body, 'staff_sales')).toBe(2);
    expect(kpiVal(body, 'active_staff')).toBe(1);
  });
  it('403 without analytics.employees.view', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const res = await teamHandler(req(sub, `/api/analytics-team?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(403);
  });
});

describe('analytics-catalog', () => {
  let ctx: Awaited<ReturnType<typeof seedPaidSales>>;
  beforeAll(async () => {
    ctx = await seedPaidSales({ when: [WHEN], channel: ['instore'], priceCents: 1000 });
  });
  it('counts active products and top sellers', async () => {
    const res = await catalogHandler(req(ctx, `/api/analytics-catalog?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.find((k: any) => k.id === 'active').value).toBeGreaterThanOrEqual(1);
    const top = body.breakdowns.find((b: any) => b.id === 'top_sellers');
    expect(top.rows.length).toBeGreaterThanOrEqual(1);
  });
  it('403 without analytics.products.view', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const res = await catalogHandler(req(sub, `/api/analytics-catalog?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(403);
  });
});

describe('analytics-bookings', () => {
  let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
  beforeAll(async () => {
    ctx = await seedClientWithBooking();
    await grantBookingPerms(ctx.clientId, 1, ['analytics.business.view']);
    const resourceId = await seedResource(ctx.clientId);
    const serviceId = await makeService(ctx.clientId, {});
    const sql = sqlClient();
    // one confirmed + one completed + one cancelled, all on FROM, assigned to owner
    const mk = (status: string, order: number) => sql`
      INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
      VALUES (${ctx.clientId}, ${serviceId}, ${resourceId}, ${ctx.ownerNodeId},
              tstzrange(${`${FROM}T1${order}:00:00Z`}::timestamptz, ${`${FROM}T1${order}:30:00Z`}::timestamptz),
              ${status}, 'Cust')`;
    await mk('confirmed', 0);
    await mk('completed', 1);
    await mk('cancelled', 2);
  });
  it('counts bookings by outcome', async () => {
    const res = await bookingsHandler(req(ctx, `/api/analytics-bookings?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(kpiVal(body, 'booked')).toBe(2);     // confirmed + completed (pending/confirmed/completed)
    expect(kpiVal(body, 'completed')).toBe(1);
    expect(kpiVal(body, 'cancelled')).toBe(1);
  });
});
