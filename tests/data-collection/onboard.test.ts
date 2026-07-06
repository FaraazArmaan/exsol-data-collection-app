import { describe, it, expect, vi } from 'vitest';

// onboard-import rate-limits via Netlify Blobs — mock it (hoisted above imports).
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
import publicHandler from '../../netlify/functions/onboard-public';
import importHandler from '../../netlify/functions/onboard-import';
import {
  seedDataCollectionClient, insertToken, publicGet, importReq, VALID_CSV, INVALID_CSV,
} from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('onboard-public validate', () => {
  it('404 for an unknown token', async () => {
    const res = await publicHandler(publicGet('/api/onboard-public/not-a-real-token'));
    expect(res.status).toBe(404);
  });

  it('200 for a live token (returns tenant name)', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx);
    const res = await publicHandler(publicGet(`/api/onboard-public/${token}`));
    expect(res.status).toBe(200);
    expect((await res.json()).tenant.name).toBeTruthy();
  });

  it('410 for a used token', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx, { used: true });
    expect((await publicHandler(publicGet(`/api/onboard-public/${token}`))).status).toBe(410);
  });

  it('410 for an expired token', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx, { expired: true });
    expect((await publicHandler(publicGet(`/api/onboard-public/${token}`))).status).toBe(410);
  });
});

describe('onboard-import', () => {
  it('dry-run previews valid rows without consuming the token', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx);
    const res = await importHandler(importReq(token, VALID_CSV, { dryRun: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).valid).toBe(2);
    // token still valid afterwards
    expect((await publicHandler(publicGet(`/api/onboard-public/${token}`))).status).toBe(200);
  });

  it('honeypot filled → 400 (no import)', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx);
    const res = await importHandler(importReq(token, VALID_CSV, { hp: 'i-am-a-bot' }));
    expect(res.status).toBe(400);
  });

  it('commit imports products and consumes the token (single-use)', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx);
    const before = (await sql`SELECT count(*)::int AS n FROM public.products WHERE client_id = ${ctx.clientId}`) as Array<{ n: number }>;

    const res = await importHandler(importReq(token, VALID_CSV));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.committed).toBe(true);
    expect(body.created).toBe(2);

    const after = (await sql`SELECT count(*)::int AS n FROM public.products WHERE client_id = ${ctx.clientId}`) as Array<{ n: number }>;
    expect(after[0]!.n - before[0]!.n).toBe(2);

    // token is now single-use consumed
    expect((await importHandler(importReq(token, VALID_CSV))).status).toBe(410);
  });

  it('commit with row errors does not consume the token', async () => {
    const ctx = await seedDataCollectionClient();
    const token = await insertToken(ctx);
    const res = await importHandler(importReq(token, INVALID_CSV));
    expect(res.status).toBe(200);
    expect((await res.json()).committed).toBe(false);
    // token still usable
    expect((await publicHandler(publicGet(`/api/onboard-public/${token}`))).status).toBe(200);
  });

  it('404 for an unknown token on import', async () => {
    const res = await importHandler(importReq('not-a-real-token', VALID_CSV));
    expect(res.status).toBe(404);
  });
});
