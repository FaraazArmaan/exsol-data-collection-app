import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import webhooksHandler from '../../netlify/functions/marketing-webhooks';
import triggersHandler from '../../netlify/functions/marketing-webhook-triggers';
import receiveHandler from '../../netlify/functions/marketing-webhook-receive';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, grantMarketingPerms, demoteToL2, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

function signedReceive(token: string, secret: string | null, body: unknown): Request {
  const raw = JSON.stringify(body);
  const sig = secret ? createHmac('sha256', secret).update(raw).digest('hex') : 'bad';
  return new Request(`http://localhost/api/marketing/webhook/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-exsol-signature': sig },
    body: raw,
  });
}

async function makeCampaign(ctx: Awaited<ReturnType<typeof seedClientWithMarketing>>, name: string): Promise<string> {
  const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
    { name, subject: 'Come back!', body_html: '<p>We miss you</p>', audience: 'all', channel: 'email' }));
  return (await c.json()).campaign.id;
}

describe('Webhook spine', () => {
  it('verifies signature, stores event, fires a matching trigger 1:1 to the payload recipient', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2);

    // Create endpoint (owner) → get token + secret.
    const epRes = await webhooksHandler(marketingRequest(ctx, 'POST', '/api/marketing/webhooks', { label: `Store-${tag}` }));
    expect(epRes.status).toBe(200);
    const { endpoint, secret } = await epRes.json();
    expect(secret).toBeTruthy();

    // Trigger: abandoned_cart → campaign.
    const campaignId = await makeCampaign(ctx, `Winback-${tag}`);
    const tRes = await triggersHandler(marketingRequest(ctx, 'POST', '/api/marketing/webhook-triggers', { event_type: 'abandoned_cart', campaign_id: campaignId }));
    expect(tRes.status).toBe(200);

    // Inbound signed event naming a recipient.
    const buyer = `wh-${tag}@x.com`;
    const res = await receiveHandler(signedReceive(endpoint.token, secret, { event_type: 'abandoned_cart', email: buyer }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(1);

    // A send was logged to that recipient for the linked campaign.
    const sends = (await sql`SELECT recipient_email, channel FROM public.campaign_sends WHERE campaign_id = ${campaignId}::uuid`) as Array<{ recipient_email: string; channel: string }>;
    expect(sends).toHaveLength(1);
    expect(sends[0]!.recipient_email).toBe(buyer);

    // Event persisted with triggered_count.
    const events = (await sql`SELECT triggered_count FROM public.marketing_webhook_events WHERE client_id = ${ctx.clientId}::uuid AND event_type = 'abandoned_cart'`) as Array<{ triggered_count: number }>;
    expect(events[0]!.triggered_count).toBe(1);
  });

  it('rejects a bad signature (401) and unknown token (404)', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const epRes = await webhooksHandler(marketingRequest(ctx, 'POST', '/api/marketing/webhooks', { label: 'ep' }));
    const { endpoint } = await epRes.json();

    const badSig = await receiveHandler(signedReceive(endpoint.token, null, { event_type: 'x' }));
    expect(badSig.status).toBe(401);

    const unknown = await receiveHandler(signedReceive('deadbeefdeadbeefdeadbeefdeadbeef', 'whatever', { event_type: 'x' }));
    expect(unknown.status).toBe(404);
  });

  it('stores an event with no matching trigger (triggered=0)', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const epRes = await webhooksHandler(marketingRequest(ctx, 'POST', '/api/marketing/webhooks', { label: 'ep' }));
    const { endpoint, secret } = await epRes.json();
    const res = await receiveHandler(signedReceive(endpoint.token, secret, { event_type: 'noise', email: 'z@x.com' }));
    const body = await res.json();
    expect(body.triggered).toBe(0);
  });

  it('endpoint creation requires edit; L2 without it gets 403', async () => {
    const owner = await seedClientWithMarketing();
    await enableMarketing(owner.clientId);
    const l2 = await demoteToL2(owner);
    const denied = await webhooksHandler(marketingRequest(l2, 'POST', '/api/marketing/webhooks', { label: 'x' }));
    expect(denied.status).toBe(403);
    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.edit']);
    const ok = await webhooksHandler(marketingRequest(l2, 'POST', '/api/marketing/webhooks', { label: 'x' }));
    expect(ok.status).toBe(200);
  });
});
