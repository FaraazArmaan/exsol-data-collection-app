import { describe, it, expect } from 'vitest';
import dashboardHandler from '../../netlify/functions/crm-dashboard';
import { seedClientWithCrm, enableCrm, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function insertCustomer(clientId: string, name: string, phone: string | null, email: string | null): Promise<string> {
  const dedupe = phone ? `phone:${phone}` : `email:${email}`;
  const r = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source)
    VALUES (${clientId}::uuid, ${name}, ${phone}, ${email}, ${dedupe}, 'pos') RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}

async function insertPaidSale(clientId: string, phone: string, totalCents: number, ownerNode: string) {
  const mx = (await sql`SELECT COALESCE(MAX(order_no),0)::int AS mx FROM public.sales WHERE bucket_id = ${clientId}::uuid`) as Array<{ mx: number }>;
  await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone,
       subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node, source)
    VALUES
      (${clientId}::uuid, ${mx[0]!.mx + 1}, 'paid', 'instore', 'Cust', ${phone},
       ${totalCents}, 0, 0, ${totalCents}, ${ownerNode}::uuid, 'pos')
  `;
}

describe('crm-dashboard', () => {
  it('computes LTV, frequency, and top customers', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const alice = await insertCustomer(ctx.clientId, 'Alice', '+919876500001', null);
    await insertCustomer(ctx.clientId, 'Bob', '+919876500002', null); // no purchases
    // Two paid sales for Alice — raw phone in both bare + prefixed forms (last-10 match).
    await insertPaidSale(ctx.clientId, '9876500001', 50000, ctx.ownerNodeId);
    await insertPaidSale(ctx.clientId, '+91 98765 00001', 30000, ctx.ownerNodeId);

    const res = await dashboardHandler(crmRequest(ctx, 'GET', '/api/crm/dashboard'));
    expect(res.status).toBe(200);
    const b = await res.json() as any;

    expect(b.kpis.total_customers).toBe(2);
    expect(b.kpis.active_customers).toBe(1);      // only Alice bought
    expect(b.kpis.total_ltv_cents).toBe(80000);
    expect(b.kpis.avg_ltv_cents).toBe(80000);     // 80000 / 1 active
    expect(b.kpis.repeat_rate).toBe(100);         // Alice has 2 orders

    const top = b.top_customers.find((c: any) => c.id === alice);
    expect(top.ltv_cents).toBe(80000);
    expect(top.txns).toBe(2);
    expect(top.last_activity).toBeTruthy();
  });

  it('returns 401 without a session', async () => {
    const res = await dashboardHandler(new Request('http://localhost/api/crm/dashboard', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('returns 412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm(); // not enabled
    const res = await dashboardHandler(crmRequest(ctx, 'GET', '/api/crm/dashboard'));
    expect(res.status).toBe(412);
  });
});
