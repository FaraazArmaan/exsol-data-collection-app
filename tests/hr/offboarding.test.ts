// Integration: offboarding default items carry the AMS action hints.
import { describe, it, expect } from 'vitest';
import instancesHandler from '../../netlify/functions/hr-checklist-instances';
import instanceHandler from '../../netlify/functions/hr-checklist-instance';
import { seedClientWithBooking, bookingRequest, sqlClient } from '../booking/_helpers';

const sql = sqlClient();
async function enableHr(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'hr', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('HR offboarding', () => {
  it('starting offboarding seeds action_hint items (disable_access, reassign_subtree)', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);
    const start = await instancesHandler(bookingRequest(ctx, 'POST', '/api/hr/checklist-instances', {
      kind: 'offboarding', subject_user_node_id: ctx.ownerNodeId,
    }));
    expect(start.status).toBe(201);
    const { id } = (await start.json()) as { id: string };
    const detail = await instanceHandler(bookingRequest(ctx, 'GET', `/api/hr/checklist-instance?id=${id}`));
    const items = ((await detail.json()) as { items: Array<{ action_hint: string | null }> }).items;
    const hints = items.map((i) => i.action_hint).filter(Boolean);
    expect(hints).toContain('disable_access');
    expect(hints).toContain('reassign_subtree');
  });
});
