import { describe, it, expect, vi } from 'vitest';

// Mock Netlify Blobs so the rate-limiter counts in-memory (real Blobs are absent
// in tests; this also lets us exercise the 429 path). Store is module-scoped and
// shared across getStore() calls — keyed by IP + time bucket, so distinct test
// IPs don't cross-contaminate.
vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, String(v)); },
    }),
  };
});

import submitHandler from '../../netlify/functions/crm-lead-submit';
import { seedClientWithCrm, enableCrm, sqlClient } from './_helpers';

const sql = sqlClient();

function pubReq(body: any, ip: string) {
  return new Request('http://localhost/api/crm/lead-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}
async function leadCount(clientId: string): Promise<number> {
  const r = (await sql`SELECT COUNT(*)::int AS n FROM public.crm_leads WHERE client_id = ${clientId}::uuid`) as Array<{ n: number }>;
  return r[0]!.n;
}

describe('crm-lead-submit (public)', () => {
  it('creates a lead for a CRM-enabled tenant', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await submitHandler(pubReq({ slug: ctx.slug, name: 'Jo', email: 'jo@example.com', message: 'interested' }, '10.0.0.1'));
    expect(res.status).toBe(200);
    expect(await leadCount(ctx.clientId)).toBe(1);
  });

  it('silently accepts + drops a honeypot submission', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await submitHandler(pubReq({ slug: ctx.slug, name: 'Bot', email: 'b@example.com', honeypot: 'gotcha' }, '10.0.0.2'));
    expect(res.status).toBe(200);
    expect(await leadCount(ctx.clientId)).toBe(0);
  });

  it('returns 404 when the tenant does not have CRM enabled', async () => {
    const ctx = await seedClientWithCrm(); // not enabled
    const res = await submitHandler(pubReq({ slug: ctx.slug, name: 'Jo', email: 'jo@example.com' }, '10.0.0.3'));
    expect(res.status).toBe(404);
  });

  it('returns 400 without any contact channel', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await submitHandler(pubReq({ slug: ctx.slug, name: 'Jo' }, '10.0.0.4'));
    expect(res.status).toBe(400);
    expect(await leadCount(ctx.clientId)).toBe(0);
  });

  it('rate-limits repeat submissions from one IP (429)', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    let last = 200;
    for (let i = 0; i < 12; i++) {
      const res = await submitHandler(pubReq({ slug: ctx.slug, name: `L${i}`, email: `l${i}@example.com` }, '10.0.0.5'));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
