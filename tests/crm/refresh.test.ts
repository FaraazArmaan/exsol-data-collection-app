import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, demoteToL2, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('POST /api/crm/refresh', () => {
  it('401 when unauthenticated', async () => {
    const res = await handler(new Request('http://localhost/api/crm/refresh', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm();
    const res = await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(412);
  });

  it('403 for an L2 without crm.customers.view', async () => {
    const owner = await seedClientWithCrm();
    await enableCrm(owner.clientId);
    const l2 = await demoteToL2(owner);
    const res = await handler(crmRequest(l2, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(403);
  });

  it('L1 owner bypass: materializes + dedupes POS sale and booking-customer into one row', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const roleId = await seedCustomerRole(ctx.clientId);
    const phone = `98${uniq().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    const email = `dup-${uniq()}@x.com`;
    // Booking-created customer node:
    await seedCustomerNode(ctx.clientId, roleId, 'Aisha Khan', phone, email);
    // A paid POS sale for the SAME identity:
    await sql`INSERT INTO public.sales (bucket_id, order_no, status, channel, source, customer_name, customer_phone, customer_email, subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
              VALUES (${ctx.clientId}, ${Math.floor(Math.random()*1e9)}, 'paid', 'instore', 'pos', 'Aisha', ${phone}, ${email}, 1000, 0, 0, 1000, ${ctx.ownerNodeId})`;

    const res = await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT * FROM public.crm_customers WHERE client_id = ${ctx.clientId}`) as any[];
    expect(rows).toHaveLength(1); // deduped

    // Idempotent: a second refresh does not duplicate.
    await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    const again = (await sql`SELECT * FROM public.crm_customers WHERE client_id = ${ctx.clientId}`) as any[];
    expect(again).toHaveLength(1);
  });
});
