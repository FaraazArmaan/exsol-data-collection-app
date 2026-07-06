import { describe, it, expect } from 'vitest';
import notesHandler from '../../netlify/functions/crm-notes';
import noteDetailHandler from '../../netlify/functions/crm-note-detail';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

async function seedOneCustomer() {
  const ctx = await seedClientWithCrm();
  await enableCrm(ctx.clientId);
  const roleId = await seedCustomerRole(ctx.clientId);
  await seedCustomerNode(ctx.clientId, roleId, 'Note Target', `98${uniq().padEnd(8,'0').slice(0,8)}`, `n-${uniq()}@x.com`);
  await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
  const c = (await sql`SELECT id FROM public.crm_customers WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  return { ctx, customerId: c[0]!.id };
}

describe('CRM notes CRUD', () => {
  it('creates, edits, and deletes a note', async () => {
    const { ctx, customerId } = await seedOneCustomer();

    const created = await notesHandler(crmRequest(ctx, 'POST', '/api/crm/notes', { customer_id: customerId, body: 'Prefers Sarah' }));
    expect(created.status).toBe(200);
    const noteId = (await created.json()).note.id;

    const edited = await noteDetailHandler(crmRequest(ctx, 'PATCH', `/api/crm/notes/${noteId}`, { body: 'Prefers Sarah, mornings' }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).note.body).toBe('Prefers Sarah, mornings');

    const del = await noteDetailHandler(crmRequest(ctx, 'DELETE', `/api/crm/notes/${noteId}`));
    expect(del.status).toBe(204);
    const rows = (await sql`SELECT id FROM public.crm_notes WHERE id = ${noteId}::uuid`) as any[];
    expect(rows).toHaveLength(0);
  });

  it('401 unauthenticated on create', async () => {
    const res = await notesHandler(new Request('http://localhost/api/crm/notes', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });
});
