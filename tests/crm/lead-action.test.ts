import { describe, it, expect } from 'vitest';
import listHandler from '../../netlify/functions/crm-leads-list';
import actionHandler from '../../netlify/functions/crm-lead-action';
import { seedClientWithCrm, enableCrm, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function insertLead(clientId: string, name: string, email: string | null, phone: string | null): Promise<string> {
  const r = (await sql`
    INSERT INTO public.crm_leads (client_id, name, email, phone, source, status)
    VALUES (${clientId}::uuid, ${name}, ${email}, ${phone}, 'public_form', 'new') RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}

describe('crm leads (vendor)', () => {
  it('lists new leads with per-status counts', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    await insertLead(ctx.clientId, 'A', 'a@example.com', null);
    await insertLead(ctx.clientId, 'B', null, '+919000000001');
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/leads?status=new'));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.leads.length).toBe(2);
    expect(b.counts.new).toBe(2);
  });

  it('converts a lead into a (deduped) customer and marks it converted', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const id = await insertLead(ctx.clientId, 'Carol', 'carol@example.com', '9876500123');
    const res = await actionHandler(crmRequest(ctx, 'POST', `/api/crm/lead-action/${id}`, { action: 'convert' }));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.status).toBe('converted');
    expect(b.customer_id).toBeTruthy();

    const cust = (await sql`SELECT source, dedupe_key FROM public.crm_customers WHERE id = ${b.customer_id}::uuid`) as any[];
    expect(cust[0].source).toBe('storefront');
    expect(cust[0].dedupe_key).toBe('phone:+919876500123');

    const lead = (await sql`SELECT status, converted_customer_id FROM public.crm_leads WHERE id = ${id}::uuid`) as any[];
    expect(lead[0].status).toBe('converted');
    expect(lead[0].converted_customer_id).toBe(b.customer_id);
  });

  it('archives a lead', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const id = await insertLead(ctx.clientId, 'D', 'd@example.com', null);
    const res = await actionHandler(crmRequest(ctx, 'POST', `/api/crm/lead-action/${id}`, { action: 'archive' }));
    expect(res.status).toBe(200);
    const lead = (await sql`SELECT status FROM public.crm_leads WHERE id = ${id}::uuid`) as any[];
    expect(lead[0].status).toBe('archived');
  });

  it('409 when acting on an already-decided lead', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const id = await insertLead(ctx.clientId, 'E', 'e@example.com', null);
    await actionHandler(crmRequest(ctx, 'POST', `/api/crm/lead-action/${id}`, { action: 'convert' }));
    const again = await actionHandler(crmRequest(ctx, 'POST', `/api/crm/lead-action/${id}`, { action: 'archive' }));
    expect(again.status).toBe(409);
  });

  it('returns 412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm();
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/leads'));
    expect(res.status).toBe(412);
  });
});
