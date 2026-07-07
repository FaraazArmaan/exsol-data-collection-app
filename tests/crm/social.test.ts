import { describe, it, expect } from 'vitest';
import socialHandler from '../../netlify/functions/crm-social';
import { seedClientWithCrm, enableCrm, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();

async function socialLeadCount(clientId: string): Promise<number> {
  const r = (await sql`SELECT COUNT(*)::int AS n FROM public.crm_leads WHERE client_id = ${clientId}::uuid AND source = 'social'`) as Array<{ n: number }>;
  return r[0]!.n;
}
const post = (ctx: any, body: any) => socialHandler(crmRequest(ctx, 'POST', '/api/crm/social', body));

describe('crm-social', () => {
  it('lists three provider cards, disconnected by default', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const b = await (await socialHandler(crmRequest(ctx, 'GET', '/api/crm/social'))).json() as any;
    expect(b.providers.length).toBe(3);
    expect(b.providers.every((p: any) => p.status === 'disconnected')).toBe(true);
  });

  it('connect → import (creates social leads) → re-import → disconnect', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);

    const conn = await (await post(ctx, { provider: 'google', action: 'connect' })).json() as any;
    const g = conn.providers.find((p: any) => p.provider === 'google');
    expect(g.status).toBe('connected');
    expect(g.account_label).toBeTruthy();

    const imp = await (await post(ctx, { provider: 'google', action: 'import' })).json() as any;
    expect(imp.imported).toBe(4);
    expect(await socialLeadCount(ctx.clientId)).toBe(4);

    const imp2 = await (await post(ctx, { provider: 'google', action: 'import' })).json() as any;
    expect(imp2.imported).toBe(4);
    expect(await socialLeadCount(ctx.clientId)).toBe(8); // fresh batch, no dupes
    expect(imp2.providers.find((p: any) => p.provider === 'google').imported_total).toBe(8);

    const dc = await (await post(ctx, { provider: 'google', action: 'disconnect' })).json() as any;
    expect(dc.providers.find((p: any) => p.provider === 'google').status).toBe('disconnected');
  });

  it('returns 409 when importing from a provider that is not connected', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await post(ctx, { provider: 'mailchimp', action: 'import' });
    expect(res.status).toBe(409);
  });

  it('returns 412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm();
    const res = await socialHandler(crmRequest(ctx, 'GET', '/api/crm/social'));
    expect(res.status).toBe(412);
  });
});
