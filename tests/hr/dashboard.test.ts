import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/hr-dashboard';
import { seedClientWithBooking, bookingRequest, sqlClient } from '../booking/_helpers';

const sql = sqlClient();
async function enableHr(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'hr', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('GET /api/hr/dashboard', () => {
  it('401 without a session', async () => {
    const res = await handler(new Request('http://localhost/api/hr/dashboard', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('412 when HR is not enabled', async () => {
    const ctx = await seedClientWithBooking();
    const res = await handler(bookingRequest(ctx, 'GET', '/api/hr/dashboard'));
    expect(res.status).toBe(412);
  });

  it('L1 Owner gets headcount + join/exit counts + workforce summary', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);
    const res = await handler(bookingRequest(ctx, 'GET', '/api/hr/dashboard'));
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      totalHeadcount: number; headcount: unknown[];
      joins: { last90: number }; exits: { last30: number }; workforce: { hours: number };
    };
    expect(d.totalHeadcount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.headcount)).toBe(true);
    expect(d.joins.last90).toBeGreaterThanOrEqual(1); // the owner node was just created
    expect(typeof d.workforce.hours).toBe('number');
  });
});
