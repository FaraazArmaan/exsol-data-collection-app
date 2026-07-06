import { describe, it, expect } from 'vitest';
import detailHandler from '../../netlify/functions/crm-customer-detail';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('GET /api/crm/customers/:id', () => {
  it('returns the customer with a live timeline of their paid sale', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const roleId = await seedCustomerRole(ctx.clientId);
    // Digits-only phone and NO email, so the timeline must match via the normalized-vs-raw
    // phone bridge (last-10-digits) — directly exercising that logic, not an email fallback.
    const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    await seedCustomerNode(ctx.clientId, roleId, 'Timeline Person', phone, null);
    await sql`INSERT INTO public.sales (bucket_id, order_no, status, channel, source, customer_name, customer_phone, customer_email, subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
              VALUES (${ctx.clientId}, ${Math.floor(Math.random()*1e9)}, 'paid', 'instore', 'pos', 'Timeline Person', ${phone}, ${null}, 2500, 0, 0, 2500, ${ctx.ownerNodeId})`;
    await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    const cust = (await sql`SELECT id FROM public.crm_customers WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
    const id = cust[0]!.id;

    const res = await detailHandler(crmRequest(ctx, 'GET', `/api/crm/customers/${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.id).toBe(id);
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.timeline.some((e: any) => e.kind === 'sale' && e.amount_cents === 2500)).toBe(true);
  });

  it('404 for an unknown id', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await detailHandler(crmRequest(ctx, 'GET', `/api/crm/customers/00000000-0000-0000-0000-000000000000`));
    expect(res.status).toBe(404);
  });
});
