import { describe, it, expect } from 'vitest';
import repeatHandler from '../../netlify/functions/crm-repeat-cart';
import { seedClientWithCrm, enableCrm, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function insertProduct(clientId: string, name: string, priceCents: number): Promise<string> {
  const r = (await sql`
    INSERT INTO public.products (client_id, type, name, price_cents, sale_price_cents, pos_visible, status, category_id)
    VALUES (${clientId}::uuid, 'physical', ${name}, ${priceCents}, NULL, true, 'active'::product_status, NULL) RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}
async function insertCustomer(clientId: string, name: string, phone: string): Promise<string> {
  const r = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source)
    VALUES (${clientId}::uuid, ${name}, ${phone}, NULL, ${`phone:${phone}`}, 'pos') RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}
async function insertSaleWithLine(clientId: string, phone: string, owner: string, productId: string, name: string, unit: number, qty: number) {
  const mx = (await sql`SELECT COALESCE(MAX(order_no),0)::int AS mx FROM public.sales WHERE bucket_id = ${clientId}::uuid`) as Array<{ mx: number }>;
  const total = unit * qty;
  const sale = (await sql`
    INSERT INTO public.sales (bucket_id, order_no, status, channel, customer_name, customer_phone,
      subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node, source)
    VALUES (${clientId}::uuid, ${mx[0]!.mx + 1}, 'paid', 'instore', 'Cust', ${phone},
      ${total}, 0, 0, ${total}, ${owner}::uuid, 'pos') RETURNING id
  `) as Array<{ id: string }>;
  await sql`
    INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
    VALUES (${sale[0]!.id}::uuid, ${productId}::uuid, ${name}, ${unit}, ${qty}, ${total}, 0)`;
}

describe('crm-repeat-cart', () => {
  it('suggests a reorder from purchase history (avg qty per order)', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const pid = await insertProduct(ctx.clientId, 'Shampoo', 30000);
    const cust = await insertCustomer(ctx.clientId, 'Alice', '+919876522001');
    await insertSaleWithLine(ctx.clientId, '9876522001', ctx.ownerNodeId, pid, 'Shampoo', 30000, 2);
    await insertSaleWithLine(ctx.clientId, '9876522001', ctx.ownerNodeId, pid, 'Shampoo', 30000, 4);

    const res = await repeatHandler(crmRequest(ctx, 'GET', `/api/crm/repeat-cart/${cust}`));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.customer_name).toBe('Alice');
    expect(b.items.length).toBe(1);
    expect(b.items[0].product_id).toBe(pid);
    expect(b.items[0].qty).toBe(3); // avg of 2 and 4
    expect(b.items[0].times_bought).toBe(2);
    expect(b.items[0].available).toBe(true);
    expect(b.items[0].unit_price_cents).toBe(30000);
  });

  it('flags an archived product as unavailable', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const pid = await insertProduct(ctx.clientId, 'OldItem', 10000);
    await sql`UPDATE public.products SET status = 'archived'::product_status WHERE id = ${pid}::uuid`;
    const cust = await insertCustomer(ctx.clientId, 'Bob', '+919876522002');
    await insertSaleWithLine(ctx.clientId, '9876522002', ctx.ownerNodeId, pid, 'OldItem', 10000, 1);
    const b = await (await repeatHandler(crmRequest(ctx, 'GET', `/api/crm/repeat-cart/${cust}`))).json() as any;
    expect(b.items[0].available).toBe(false);
  });

  it('returns empty items for a customer with no purchases', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const cust = await insertCustomer(ctx.clientId, 'NoBuy', '+919876522003');
    const b = await (await repeatHandler(crmRequest(ctx, 'GET', `/api/crm/repeat-cart/${cust}`))).json() as any;
    expect(b.items).toEqual([]);
  });

  it('returns 404 for an unknown customer and 412 when disabled', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const r404 = await repeatHandler(crmRequest(ctx, 'GET', `/api/crm/repeat-cart/${crypto.randomUUID()}`));
    expect(r404.status).toBe(404);

    const off = await seedClientWithCrm();
    const r412 = await repeatHandler(crmRequest(off, 'GET', `/api/crm/repeat-cart/${crypto.randomUUID()}`));
    expect(r412.status).toBe(412);
  });
});
