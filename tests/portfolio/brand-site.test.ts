// Integration: brand-site editor (authz + save/publish) and pub-site (public,
// publish-gated). Reuses booking helpers for the client + owner/L2 sessions.
// pub-site rate-limits via Netlify Blobs → mock getStore (this whole file).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    }),
  };
});

import brandSiteHandler from '../../netlify/functions/brand-site';
import pubSiteHandler from '../../netlify/functions/pub-site';
import { seedClientWithBooking, bookingRequest, sqlClient, demoteToL2 } from '../booking/_helpers';

const sql = sqlClient();

async function enablePortfolio(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'brand-portfolio', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('brand-site editor (authed)', () => {
  it('401 without a session', async () => {
    const res = await brandSiteHandler(new Request('http://localhost/api/brand-site', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('412 when the portfolio module is not enabled (even for the Owner)', async () => {
    const ctx = await seedClientWithBooking();
    const res = await brandSiteHandler(bookingRequest(ctx, 'GET', '/api/brand-site'));
    expect(res.status).toBe(412);
  });

  it('L1 Owner: GET defaults → PUT saves+publishes → GET reflects', async () => {
    const ctx = await seedClientWithBooking();
    await enablePortfolio(ctx.clientId, ctx.adminId);

    const g1 = await brandSiteHandler(bookingRequest(ctx, 'GET', '/api/brand-site'));
    expect(g1.status).toBe(200);
    expect(((await g1.json()) as { published: boolean }).published).toBe(false);

    const put = await brandSiteHandler(bookingRequest(ctx, 'PUT', '/api/brand-site', {
      sections: { hero: { enabled: true, tagline: 'Fresh cuts' }, contact: { enabled: true, email: 'x@y.z' } },
      published: true,
    }));
    expect(put.status).toBe(200);

    const g2 = await brandSiteHandler(bookingRequest(ctx, 'GET', '/api/brand-site'));
    const b2 = (await g2.json()) as { published: boolean; sections: { hero?: { tagline?: string } } };
    expect(b2.published).toBe(true);
    expect(b2.sections.hero?.tagline).toBe('Fresh cuts');
  });

  it('403 for an L2 without portfolio.business.view', async () => {
    const ctx = await seedClientWithBooking();
    await enablePortfolio(ctx.clientId, ctx.adminId);
    const l2 = await demoteToL2(ctx);
    const res = await brandSiteHandler(bookingRequest(l2, 'GET', '/api/brand-site'));
    expect(res.status).toBe(403);
  });
});

describe('pub-site (public)', () => {
  it('published:false when the site is not published', async () => {
    const ctx = await seedClientWithBooking();
    const res = await pubSiteHandler(new Request(`http://localhost/api/public/site/${ctx.slug}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: boolean }).published).toBe(false);
  });

  it('returns the section config once published', async () => {
    const ctx = await seedClientWithBooking();
    await enablePortfolio(ctx.clientId, ctx.adminId);
    await brandSiteHandler(bookingRequest(ctx, 'PUT', '/api/brand-site', {
      sections: { hero: { enabled: true, tagline: 'Live now' } }, published: true,
    }));
    const res = await pubSiteHandler(new Request(`http://localhost/api/public/site/${ctx.slug}`));
    const body = (await res.json()) as { published: boolean; sections: { hero?: { tagline?: string } } };
    expect(body.published).toBe(true);
    expect(body.sections.hero?.tagline).toBe('Live now');
  });

  it('404 for an unknown slug', async () => {
    const res = await pubSiteHandler(new Request('http://localhost/api/public/site/no-such-slug-zzz-999'));
    expect(res.status).toBe(404);
  });
});
