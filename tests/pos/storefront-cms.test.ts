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

import { neon } from '@neondatabase/serverless';
import cmsHandler from '../../netlify/functions/pos-storefront-cms';
import menuHandler from '../../netlify/functions/pub-menu';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 90000;
function menuReq(slug: string): Request {
  const ip = `10.4.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost/api/public/menu/${slug}`, { method: 'GET', headers: { 'x-nf-client-connection-ip': ip } });
}
async function seedFull(): Promise<PosTestCtx & { slug: string }> {
  const ctx = await seedClientWithProductsEnabled();
  const rows = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${ctx.clientId} RETURNING slug`) as Array<{ slug: string }>;
  return { ...ctx, slug: rows[0]!.slug };
}

const sections = {
  hero: { enabled: true, heading: 'Welcome to Papa’s', subheading: 'Fresh cuts', ctaLabel: 'Book', ctaHref: '/book' },
  banners: [{ text: 'Free chai with every cut' }],
};

describe('storefront CMS', () => {
  it('published sections appear on the public menu; GET round-trips', async () => {
    const ctx = await seedFull();
    const put = await cmsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/storefront-cms', { sections, published: true }));
    expect(put.status).toBe(200);

    const get = await cmsHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/storefront-cms'));
    const gj = (await get.json()) as { sections: typeof sections; published: boolean };
    expect(gj.published).toBe(true);
    expect(gj.sections.hero.heading).toBe('Welcome to Papa’s');

    const menu = await menuHandler(menuReq(ctx.slug));
    const mj = (await menu.json()) as { cms?: typeof sections };
    expect(mj.cms?.hero.enabled).toBe(true);
    expect(mj.cms?.banners?.[0]!.text).toBe('Free chai with every cut');
  });

  it('unpublished sections are hidden from the public menu', async () => {
    const ctx = await seedFull();
    await cmsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/storefront-cms', { sections, published: false }));
    const menu = await menuHandler(menuReq(ctx.slug));
    const mj = (await menu.json()) as { cms?: unknown };
    expect(mj.cms).toBeUndefined();
  });

  it('rejects unknown section keys (strict schema)', async () => {
    const ctx = await seedFull();
    const bad = await cmsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/storefront-cms', { sections: { evil: true }, published: true }));
    expect(bad.status).toBe(400);
  });

  it('rejects a javascript: CTA href (stored XSS guard)', async () => {
    const ctx = await seedFull();
    const bad = await cmsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/storefront-cms', {
      sections: { hero: { enabled: true, heading: 'Hi', ctaLabel: 'Go', ctaHref: 'javascript:alert(1)' } },
      published: true,
    }));
    expect(bad.status).toBe(400);
    // A safe relative path is still accepted.
    const ok = await cmsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/storefront-cms', {
      sections: { hero: { enabled: true, heading: 'Hi', ctaLabel: 'Go', ctaHref: '/book' } },
      published: true,
    }));
    expect(ok.status).toBe(200);
  });
});
