import { describe, it, expect } from 'vitest';
import { audienceRecipients, audienceCount } from '../../src/modules/marketing/lib/audience';
import { seedClientWithMarketing, seedCrmCustomer, sqlClient } from './_helpers';

const sql = sqlClient();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe('marketing audience', () => {
  it('counts only emailable customers for "all"', async () => {
    const ctx = await seedClientWithMarketing();
    await seedCrmCustomer(ctx.clientId, { email: `a-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: `b-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null }); // phone-only, excluded
    expect(await audienceCount(sql, ctx.clientId, 'all')).toBe(2);
  });

  it('recent_30d excludes customers last seen > 30 days ago', async () => {
    const ctx = await seedClientWithMarketing();
    await seedCrmCustomer(ctx.clientId, { email: `r-${Math.random().toString(36).slice(2)}@x.com`, lastSeen: daysAgo(5) });
    await seedCrmCustomer(ctx.clientId, { email: `o-${Math.random().toString(36).slice(2)}@x.com`, lastSeen: daysAgo(60) });
    expect(await audienceCount(sql, ctx.clientId, 'all')).toBe(2);
    expect(await audienceCount(sql, ctx.clientId, 'recent_30d')).toBe(1);
  });

  it('audienceRecipients returns id+email for emailable rows only', async () => {
    const ctx = await seedClientWithMarketing();
    const em = `c-${Math.random().toString(36).slice(2)}@x.com`;
    await seedCrmCustomer(ctx.clientId, { email: em });
    await seedCrmCustomer(ctx.clientId, { email: null });
    const rows = await audienceRecipients(sql, ctx.clientId, 'all');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(em);
  });
});
