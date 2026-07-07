// Integration: HR checklist flow (shared by onboarding + offboarding).
import { describe, it, expect } from 'vitest';
import instancesHandler from '../../netlify/functions/hr-checklist-instances';
import instanceHandler from '../../netlify/functions/hr-checklist-instance';
import templatesHandler from '../../netlify/functions/hr-checklist-templates';
import { seedClientWithBooking, bookingRequest, sqlClient } from '../booking/_helpers';

const sql = sqlClient();
async function enableHr(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'hr', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('HR checklists', () => {
  it('401 without a session', async () => {
    const res = await instancesHandler(new Request('http://localhost/api/hr/checklist-instances?kind=onboarding', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('onboarding: start with default items → get → toggle → complete', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);

    const start = await instancesHandler(bookingRequest(ctx, 'POST', '/api/hr/checklist-instances', {
      kind: 'onboarding', subject_user_node_id: ctx.ownerNodeId,
    }));
    expect(start.status).toBe(201);
    const { id } = (await start.json()) as { id: string };

    const detail = await instanceHandler(bookingRequest(ctx, 'GET', `/api/hr/checklist-instance?id=${id}`));
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as { instance: { status: string }; items: Array<{ id: string; done: boolean }> };
    expect(d.items.length).toBeGreaterThanOrEqual(1);
    expect(d.instance.status).toBe('open');

    const tog = await instanceHandler(bookingRequest(ctx, 'PATCH', `/api/hr/checklist-instance?id=${id}`, {
      action: 'toggle-item', item_id: d.items[0]!.id, done: true,
    }));
    expect(tog.status).toBe(200);

    const list = await instancesHandler(bookingRequest(ctx, 'GET', '/api/hr/checklist-instances?kind=onboarding'));
    const lb = (await list.json()) as { instances: Array<{ id: string; done: number; total: number }> };
    expect(lb.instances.find((x) => x.id === id)?.done).toBe(1);

    const comp = await instanceHandler(bookingRequest(ctx, 'PATCH', `/api/hr/checklist-instance?id=${id}`, { action: 'complete' }));
    expect(comp.status).toBe(200);
    const after = await instanceHandler(bookingRequest(ctx, 'GET', `/api/hr/checklist-instance?id=${id}`));
    expect(((await after.json()) as { instance: { status: string } }).instance.status).toBe('completed');
  });

  it('start an instance from a created template copies its items', async () => {
    const ctx = await seedClientWithBooking();
    await enableHr(ctx.clientId, ctx.adminId);
    const tpl = await templatesHandler(bookingRequest(ctx, 'POST', '/api/hr/checklist-templates', {
      kind: 'onboarding', name: 'Standard', items: [{ label: 'Alpha' }, { label: 'Beta' }],
    }));
    expect(tpl.status).toBe(201);
    const { id: templateId } = (await tpl.json()) as { id: string };

    const start = await instancesHandler(bookingRequest(ctx, 'POST', '/api/hr/checklist-instances', {
      kind: 'onboarding', subject_user_node_id: ctx.ownerNodeId, template_id: templateId,
    }));
    const { id } = (await start.json()) as { id: string };
    const detail = await instanceHandler(bookingRequest(ctx, 'GET', `/api/hr/checklist-instance?id=${id}`));
    const items = ((await detail.json()) as { items: Array<{ label: string }> }).items;
    expect(items.map((i) => i.label).sort()).toEqual(['Alpha', 'Beta']);
  });
});
