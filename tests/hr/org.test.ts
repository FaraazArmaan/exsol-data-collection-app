// Integration: GET /api/hr/org authz + tree. Reuses the booking helpers; the HR
// module rides its own 'hr' product, so we enable that (not saloon-booking).
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/hr-org';
import { seedClientWithBooking, bookingRequest, sqlClient, demoteToL2 } from '../booking/_helpers';

const sql = sqlClient();

async function enableHr(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'hr', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('GET /api/hr/org', () => {
  it('401 without a session', async () => {
    const res = await handler(new Request('http://localhost/api/hr/org', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('412 when the HR module is not enabled', async () => {
    const ctx = await seedClientWithBooking();
    const res = await handler(bookingRequest(ctx, 'GET', '/api/hr/org'));
    expect(res.status).toBe(412);
  });

  it('L1 Owner gets the org tree when HR is enabled', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);
    const res = await handler(bookingRequest(ctx, 'GET', '/api/hr/org'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: Array<{ id: string; parent_id: string | null; display_name: string }> };
    expect(body.nodes.length).toBeGreaterThanOrEqual(1);
    expect(body.nodes.some((n) => n.id === ctx.ownerNodeId)).toBe(true);
  });

  it('403 for an L2 without hr.employees.view', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);
    const l2 = await demoteToL2(ctx);
    const res = await handler(bookingRequest(l2, 'GET', '/api/hr/org'));
    expect(res.status).toBe(403);
  });
});
