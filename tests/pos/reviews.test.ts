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
import submitHandler from '../../netlify/functions/pub-review-create';
import listHandler from '../../netlify/functions/pub-reviews';
import queueHandler from '../../netlify/functions/pos-reviews';
import moderateHandler from '../../netlify/functions/pos-review-detail';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 50000;
function publicPost(path: string, body: unknown): Request {
  const ip = `10.7.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: JSON.stringify(body),
  });
}
function publicGet(path: string): Request {
  const ip = `10.7.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, { method: 'GET', headers: { 'x-nf-client-connection-ip': ip } });
}

async function seedFullStorefront(): Promise<PosTestCtx & { slug: string }> {
  const ctx = await seedClientWithProductsEnabled();
  const rows = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${ctx.clientId} RETURNING slug`) as Array<{ slug: string }>;
  return { ...ctx, slug: rows[0]!.slug };
}

describe('reviews / Q&A', () => {
  it('public submit → pending; not shown until approved; then visible', async () => {
    const ctx = await seedFullStorefront();
    const sub = await submitHandler(publicPost('/api/public/reviews', {
      slug: ctx.slug, honeypot: '', kind: 'review', rating: 5, authorName: 'Asha', body: 'Great fade!',
    }));
    expect(sub.status).toBe(201);

    // Not yet public.
    const before = await listHandler(publicGet(`/api/public/reviews/${ctx.slug}`));
    const bj = (await before.json()) as { reviews: unknown[] };
    expect(bj.reviews).toHaveLength(0);

    // Staff sees it in the pending queue (L1 owner bypasses to pos.history.viewAll).
    const queue = await queueHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/reviews?status=pending'));
    const qj = (await queue.json()) as { reviews: Array<{ id: string; body: string }> };
    const row = qj.reviews.find((r) => r.body === 'Great fade!');
    expect(row).toBeTruthy();

    // Approve → becomes public with the rating summary.
    const mod = await moderateHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/pos/reviews/${row!.id}`, { status: 'approved' }));
    expect(mod.status).toBe(200);
    const after = await listHandler(publicGet(`/api/public/reviews/${ctx.slug}`));
    const aj = (await after.json()) as { reviews: Array<{ body: string }>; summary: { avgRating: number; reviewCount: number } };
    expect(aj.reviews.some((r) => r.body === 'Great fade!')).toBe(true);
    expect(aj.summary.avgRating).toBe(5);
    expect(aj.summary.reviewCount).toBe(1);
  });

  it('question + staff answer shows in the public Q&A', async () => {
    const ctx = await seedFullStorefront();
    const sub = await submitHandler(publicPost('/api/public/reviews', {
      slug: ctx.slug, honeypot: '', kind: 'question', authorName: 'Ravi', body: 'Do you take walk-ins?',
    }));
    const { id } = (await sub.json()) as { id: string };
    await moderateHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/pos/reviews/${id}`, { status: 'approved', answer: 'Yes, daily 10-6.' }));

    const list = await listHandler(publicGet(`/api/public/reviews/${ctx.slug}`));
    const lj = (await list.json()) as { questions: Array<{ body: string; answer: string }> };
    expect(lj.questions[0]!.answer).toBe('Yes, daily 10-6.');
  });

  it('honeypot filled → silent 200, no row written', async () => {
    const ctx = await seedFullStorefront();
    const before = (await sql`SELECT count(*)::int AS n FROM public.product_reviews WHERE client_id = ${ctx.clientId}`) as Array<{ n: number }>;
    const res = await submitHandler(publicPost('/api/public/reviews', {
      slug: ctx.slug, honeypot: 'bot', kind: 'review', rating: 1, authorName: 'Bot', body: 'spam',
    }));
    expect(res.status).toBe(200);
    const after = (await sql`SELECT count(*)::int AS n FROM public.product_reviews WHERE client_id = ${ctx.clientId}`) as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('review without a rating is rejected (400)', async () => {
    const ctx = await seedFullStorefront();
    const res = await submitHandler(publicPost('/api/public/reviews', {
      slug: ctx.slug, honeypot: '', kind: 'review', authorName: 'NoStars', body: 'forgot rating',
    }));
    expect(res.status).toBe(400);
  });
});
