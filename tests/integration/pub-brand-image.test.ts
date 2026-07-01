import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// Rate limiter uses @netlify/blobs — back it with an in-memory Map.
vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    }),
  };
});

// brandStore backed by an in-memory blob Map; all other _shared/brand exports real.
const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/brand', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/brand')>();
  return {
    ...original,
    brandStore: () => ({
      set: async (k: string, d: ArrayBuffer) => { blobStore.set(k, d); },
      get: async (k: string) => blobStore.get(k) ?? null,
      delete: async (k: string) => { blobStore.delete(k); },
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import pubBrandImageHandler from '../../netlify/functions/pub-brand-image';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pub-img-admin@example.com';
const ADMIN_PASSWORD = 'pub-img-pw';
const sql = neon(process.env.DATABASE_URL!);
let clientId = '';
let slug = '';
let logoKey = '';
const created: string[] = [];

beforeAll(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'Pub Img Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_bootstrap = true
  `;
  const lr = await loginHandler(new Request('http://x/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  const cookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
  const cr = await clientsHandler(new Request('http://x/api/clients', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Pub Img Co ${Date.now()}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  clientId = cb.client.id;
  slug = cb.client.slug;
  created.push(clientId);
  logoKey = `brand/${clientId}/logo`;
  await sql`UPDATE public.clients SET brand_logo_key = ${logoKey} WHERE id = ${clientId}::uuid`;
  // PNG bytes into the mocked brand store.
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47], 0);
  blobStore.set(logoKey, png.buffer);
});
afterAll(async () => { for (const id of created) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; });

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: 'GET', headers: { 'x-forwarded-for': '8.8.8.8' } });
}

describe('GET /api/public/brand/:slug/image/:key', () => {
  test('owned key → 200 with 24h cache + sniffed content-type', async () => {
    const res = await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/${logoKey}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  test('foreign/unowned but well-formed key → 404 (leak guard)', async () => {
    const foreign = `brand/${clientId}/logo_alt`; // valid shape, not stored/owned
    expect((await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/${foreign}`))).status).toBe(404);
  });

  test('unknown-prefix key → 404', async () => {
    expect((await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/product-images/x/y`))).status).toBe(404);
  });

  test('unknown slug → 404', async () => {
    expect((await pubBrandImageHandler(get(`/api/public/brand/nope-xyz/image/${logoKey}`))).status).toBe(404);
  });
});
