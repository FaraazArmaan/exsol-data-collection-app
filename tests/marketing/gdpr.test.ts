import { describe, it, expect } from 'vitest';
import exportHandler from '../../netlify/functions/marketing-gdpr-export';
import eraseHandler from '../../netlify/functions/marketing-gdpr-erase';
import consentHandler from '../../netlify/functions/marketing-gdpr-consent';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, grantMarketingPerms, demoteToL2, seedCrmCustomer, seedSale, seedBooking, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function seedPersonEverywhere(ctx: Awaited<ReturnType<typeof seedClientWithMarketing>>, email: string) {
  await seedCrmCustomer(ctx.clientId, { email });
  await seedSale(ctx.clientId, { email, totalCents: 12_000, status: 'paid' });
  await seedBooking(ctx.clientId, ctx.ownerNodeId, { email, priceCents: 8_000, status: 'completed' });
  const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
    { name: `g-${Math.random()}`, subject: 'S', body_html: '<p>x</p>', audience: 'all' }));
  const campId = (await c.json()).campaign.id;
  await sql`INSERT INTO public.campaign_sends (client_id, campaign_id, channel, recipient_email, status) VALUES (${ctx.clientId}::uuid, ${campId}::uuid, 'email', ${email}, 'logged')`;
}

describe('GDPR toolbox', () => {
  it('exports a person\'s data across all tables', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const email = `export-${Math.random().toString(36).slice(2)}@x.com`;
    await seedPersonEverywhere(ctx, email);

    const res = await exportHandler(marketingRequest(ctx, 'GET', `/api/marketing/gdpr/export?email=${encodeURIComponent(email)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const bundle = await res.json();
    expect(bundle.crm_customers.length).toBe(1);
    expect(bundle.sales.length).toBe(1);
    expect(bundle.bookings.length).toBe(1);
    expect(bundle.campaign_sends.length).toBe(1);
  });

  it('erases (anonymizes) PII across crm/sales/bookings/sends and logs it', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const email = `erase-${Math.random().toString(36).slice(2)}@x.com`;
    await seedPersonEverywhere(ctx, email);

    const res = await eraseHandler(marketingRequest(ctx, 'POST', '/api/marketing/gdpr/erase', { email }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toMatchObject({ crm_customers: 1, sales: 1, bookings: 1, campaign_sends: 1 });

    // Sale kept (financial) but PII stripped; email nulled, name placeholdered.
    const sale = (await sql`SELECT customer_name, customer_email, customer_phone FROM public.sales WHERE bucket_id = ${ctx.clientId}::uuid AND customer_name = '[erased]'`) as Array<{ customer_name: string; customer_email: string | null; customer_phone: string }>;
    expect(sale).toHaveLength(1);
    expect(sale[0]!.customer_email).toBeNull();
    expect(sale[0]!.customer_phone).toBe('[erased]');

    // A re-export now finds nothing by that email.
    const after = await exportHandler(marketingRequest(ctx, 'GET', `/api/marketing/gdpr/export?email=${encodeURIComponent(email)}`));
    const bundle = await after.json();
    expect(bundle.sales.length).toBe(0);
    expect(bundle.crm_customers.length).toBe(0);

    const log = (await sql`SELECT affected FROM public.marketing_erasure_log WHERE client_id = ${ctx.clientId}::uuid AND email = ${email}`) as Array<{ affected: Record<string, number> }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.affected.sales).toBe(1);
  });

  it('records + lists consent', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const email = `consent-${Math.random().toString(36).slice(2)}@x.com`;
    const post = await consentHandler(marketingRequest(ctx, 'POST', '/api/marketing/gdpr/consent', { email, channel: 'email', granted: false, source: 'unsubscribe' }));
    expect(post.status).toBe(200);
    const hist = await consentHandler(marketingRequest(ctx, 'GET', `/api/marketing/gdpr/consent?email=${encodeURIComponent(email)}`));
    const body = await hist.json();
    expect(body.consent).toHaveLength(1);
    expect(body.consent[0].granted).toBe(false);
    expect(body.consent[0].channel).toBe('email');
  });

  it('erase requires customers.delete (L2 with only view is denied)', async () => {
    const owner = await seedClientWithMarketing();
    await enableMarketing(owner.clientId);
    const l2 = await demoteToL2(owner);
    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.view']);
    const denied = await eraseHandler(marketingRequest(l2, 'POST', '/api/marketing/gdpr/erase', { email: 'x@y.com' }));
    expect(denied.status).toBe(403);
    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.view', 'marketing.customers.delete']);
    const ok = await eraseHandler(marketingRequest(l2, 'POST', '/api/marketing/gdpr/erase', { email: 'x@y.com' }));
    expect(ok.status).toBe(200);
  });
});
