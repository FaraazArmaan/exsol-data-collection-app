import { describe, it, expect } from 'vitest';
import timelineHandler from '../../netlify/functions/crm-timeline';
import { seedClientWithCrm, enableCrm, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function insertCustomer(clientId: string, name: string, phone: string, email: string): Promise<string> {
  const r = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source)
    VALUES (${clientId}::uuid, ${name}, ${phone}, ${email}, ${`phone:${phone}`}, 'pos') RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}
async function insertSale(clientId: string, phone: string, cents: number, owner: string) {
  const mx = (await sql`SELECT COALESCE(MAX(order_no),0)::int AS mx FROM public.sales WHERE bucket_id = ${clientId}::uuid`) as Array<{ mx: number }>;
  await sql`
    INSERT INTO public.sales (bucket_id, order_no, status, channel, customer_name, customer_phone,
      subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node, source)
    VALUES (${clientId}::uuid, ${mx[0]!.mx + 1}, 'paid', 'instore', 'Cust', ${phone},
      ${cents}, 0, 0, ${cents}, ${owner}::uuid, 'pos')`;
}

describe('crm-timeline', () => {
  it('merges sales, notes, emails, and campaigns into one stream sorted newest-first', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const cust = await insertCustomer(ctx.clientId, 'Alice', '+919876511001', 'alice@example.com');

    await insertSale(ctx.clientId, '9876511001', 40000, ctx.ownerNodeId);
    await sql`INSERT INTO public.crm_notes (client_id, customer_id, body) VALUES (${ctx.clientId}::uuid, ${cust}::uuid, 'Called about a refund')`;
    await sql`INSERT INTO public.email_outbox (client_id, to_email, template, subject, payload, body_html, status)
              VALUES (${ctx.clientId}::uuid, 'alice@example.com', 'storefront_receipt', 'Your receipt', '{}'::jsonb, '<p>hi</p>', 'sent')`;
    const camp = (await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, status)
              VALUES (${ctx.clientId}::uuid, 'July promo', 'Big sale', '<p>sale</p>', 'sent') RETURNING id`) as Array<{ id: string }>;
    await sql`INSERT INTO public.campaign_sends (client_id, campaign_id, customer_id, recipient_email, status)
              VALUES (${ctx.clientId}::uuid, ${camp[0]!.id}::uuid, ${cust}::uuid, 'alice@example.com', 'sent')`;

    const res = await timelineHandler(crmRequest(ctx, 'GET', `/api/crm/timeline/${cust}`));
    expect(res.status).toBe(200);
    const b = await res.json() as any;

    const kinds = new Set(b.events.map((e: any) => e.kind));
    expect(kinds.has('sale')).toBe(true);
    expect(kinds.has('note')).toBe(true);
    expect(kinds.has('email')).toBe(true);
    expect(kinds.has('campaign')).toBe(true);

    // Descending by time.
    const times = b.events.map((e: any) => new Date(e.when).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);

    const note = b.events.find((e: any) => e.kind === 'note');
    expect(note.subtitle).toBe('Called about a refund');
    expect(note.editable).toBe(true);

    const sale = b.events.find((e: any) => e.kind === 'sale');
    expect(sale.amount_cents).toBe(40000);
    expect(sale.editable).toBe(false);
  });

  it('returns 404 for an unknown / cross-tenant customer id', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await timelineHandler(crmRequest(ctx, 'GET', `/api/crm/timeline/${crypto.randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it('returns 412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm();
    const res = await timelineHandler(crmRequest(ctx, 'GET', `/api/crm/timeline/${crypto.randomUUID()}`));
    expect(res.status).toBe(412);
  });
});
