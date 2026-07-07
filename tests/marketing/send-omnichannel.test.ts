import { describe, it, expect } from 'vitest';
import sendHandler from '../../netlify/functions/marketing-campaign-send';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

describe('POST /api/marketing/send — omnichannel', () => {
  it('sms campaign reaches phone-having customers; logs channel + phone, not email', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2);
    await seedCrmCustomer(ctx.clientId, { email: `p1-${tag}@x.com` }); // has phone (helper always sets one)
    await seedCrmCustomer(ctx.clientId, { email: `p2-${tag}@x.com` });
    // A customer with an email but NO phone — must be excluded from an sms send.
    await sql`INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
              VALUES (${ctx.clientId}::uuid, 'No Phone', NULL, ${`np-${tag}@x.com`}, ${`email:np-${tag}`}, 'pos', now(), now())`;

    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: `SMS-${tag}`, subject: 'Deal', body_html: '<p>Deal</p>', audience: 'all', channel: 'sms' }));
    expect((await c.clone().json()).campaign.channel).toBe('sms');
    const id = (await c.json()).campaign.id;

    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe('sms');
    expect(body.sent).toBe(2); // phone-having only; the no-phone row excluded
    expect(body.byStatus).toMatchObject({ logged: 2 }); // sms is a mock seam

    const sends = (await sql`SELECT channel, recipient_email, recipient_phone FROM public.campaign_sends WHERE campaign_id = ${id}::uuid`) as Array<{ channel: string; recipient_email: string | null; recipient_phone: string | null }>;
    expect(sends).toHaveLength(2);
    expect(sends.every((s) => s.channel === 'sms')).toBe(true);
    expect(sends.every((s) => s.recipient_phone && s.recipient_email === null)).toBe(true);
  });

  it('defaults to email when no channel supplied (v1 behaviour preserved)', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2);
    await seedCrmCustomer(ctx.clientId, { email: `e1-${tag}@x.com` });
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: `Email-${tag}`, subject: 'Hi', body_html: '<p>Hi</p>', audience: 'all' }));
    const created = (await c.json()).campaign;
    expect(created.channel).toBe('email');

    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: created.id }));
    const body = await res.json();
    expect(body.channel).toBe('email');
    const sends = (await sql`SELECT channel, recipient_email, recipient_phone FROM public.campaign_sends WHERE campaign_id = ${created.id}::uuid`) as Array<{ channel: string; recipient_email: string | null; recipient_phone: string | null }>;
    expect(sends[0]!.channel).toBe('email');
    expect(sends[0]!.recipient_email).toBeTruthy();
    expect(sends[0]!.recipient_phone).toBeNull();
  });
});
